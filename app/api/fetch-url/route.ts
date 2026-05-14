import { NextResponse } from 'next/server';
import { performance } from 'perf_hooks';

export const maxDuration = 30; 

export async function POST(req: Request) {
  const startTime = performance.now();
  const logs: string[] = [];
  
  const logStep = (step: string) => {
    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    const message = `[${elapsed}s] ${step}`;
    logs.push(message);
    console.log(message);
  };

  let browser: any = null;
  
  try {
    const { url } = await req.json();
    logStep(`Starting scrape for: ${url}`);

    // 1. Launch Browser
    const launchStart = performance.now();
    const { chromium } = await import('playwright-core');
    const sparticuzModule = await import('@sparticuz/chromium');
    const sparticuz = (sparticuzModule as any).default || sparticuzModule;
    
    browser = await chromium.launch({
      executablePath: await sparticuz.executablePath(),
      headless: true,
      args: [...sparticuz.args, '--no-sandbox', '--disable-dev-shm-usage', '--single-process'],
    });
    logStep(`Browser launched (took ${((performance.now() - launchStart) / 1000).toFixed(2)}s)`);

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1080, height: 720 },
    });
    const page = await context.newPage();

    // Block heavy resources
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media', 'other'].includes(type)) return route.abort();
      return route.continue();
    });

    // 2. Navigation
    logStep("Navigating to URL...");
    const navStart = performance.now();
    try {
      // We set a 15s timeout for navigation
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      logStep(`Navigation finished (took ${((performance.now() - navStart) / 1000).toFixed(2)}s)`);
    } catch (e: any) {
      logStep(`Navigation warning: ${e.message}`);
    }

    // Check if browser is still alive after navigation
    if (browser.isConnected() === false || page.isClosed()) {
      throw new Error("Browser process crashed during navigation (likely Out of Memory)");
    }

    // 3. Extraction
    logStep("Starting evaluation...");
    const evalStart = performance.now();
    const data = await page.evaluate(() => {
      const title = document.title;
      const noisySelectors = ['script', 'style', 'noscript', 'header', 'footer', 'nav', 'aside'];
      noisySelectors.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
      
      const text = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 8000);
      const links = Array.from(document.querySelectorAll('a'))
        .slice(0, 50)
        .map(a => ({ href: a.href, text: a.innerText.trim() }))
        .filter(l => l.href.startsWith('http'));

      return { text, title, links };
    });
    logStep(`Evaluation finished (took ${((performance.now() - evalStart) / 1000).toFixed(2)}s)`);

    // 4. Screenshot
    let screenshotBase64 = '';
    if (!page.isClosed()) {
      logStep("Attempting screenshot...");
      try {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 15 });
        screenshotBase64 = buffer.toString('base64');
        logStep("Screenshot successful");
      } catch (e: any) {
        logStep(`Screenshot failed: ${e.message}`);
      }
    }

    logStep("Scrape complete. Closing browser.");
    await browser.close();

    return NextResponse.json({
      ...data,
      screenshot: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64}` : null,
      debugLogs: logs
    });

  } catch (err: any) {
    const errorTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.error(`[${errorTime}s] CRITICAL ERROR:`, err.message);
    
    return NextResponse.json({ 
      error: err.message, 
      at: `${errorTime}s`,
      logs: logs 
    }, { status: 500 });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}