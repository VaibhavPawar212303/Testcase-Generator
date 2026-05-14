import { NextResponse } from 'next/server';
import { performance } from 'perf_hooks';

export const maxDuration = 30; // REQUIRED for Vercel Pro

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
    const targetUrl = new URL(url);
    logStep(`Starting scrape for: ${url}`);

    // 1. Launch Browser
    const { chromium } = await import('playwright-core');
    const sparticuzModule = await import('@sparticuz/chromium');
    const sparticuz = (sparticuzModule as any).default || sparticuzModule;
    
    browser = await chromium.launch({
      executablePath: await sparticuz.executablePath(),
      headless: true, // Serverless requires true
      args: [
        ...sparticuz.args, 
        '--no-sandbox', 
        '--disable-dev-shm-usage', 
        '--single-process',
        '--disable-setuid-sandbox'
      ],
    });
    logStep(`Browser launched`);

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1080, height: 720 },
    });
    
    const page = await context.newPage();

    // Aggressively block everything except the document and essential scripts
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media', 'manifest', 'stylesheet'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // 2. Navigation with Status Check
    logStep("Navigating...");
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 15000 
    });

    const status = response?.status() || 'Unknown';
    logStep(`URL responded with HTTP ${status}`);

    if (status >= 400) {
      logStep(`Warning: Page returned error status ${status}`);
    }

    // 3. Extraction with Absolute Link Resolution
    logStep("Extracting data...");
    const data = await page.evaluate((baseHostname) => {
      const title = document.title;
      
      // Resolve all links to Absolute URLs immediately
      const allLinks = Array.from(document.querySelectorAll('a'))
        .map(a => {
          try {
            // Using a.href resolves relative paths (e.g. /contact) to absolute (https://site.com/contact)
            const absoluteUrl = a.href;
            const urlObj = new URL(absoluteUrl);
            
            return {
              href: absoluteUrl,
              text: a.innerText.trim().slice(0, 50),
              isInternal: urlObj.hostname === baseHostname
            };
          } catch (e) {
            return null;
          }
        })
        .filter((l): l is { href: string; text: string; isInternal: boolean } => 
          l !== null && l.href.startsWith('http')
        );

      // Remove noise to save response size
      const noisy = ['script', 'style', 'noscript', 'header', 'footer', 'nav'];
      noisy.forEach(s => document.querySelectorAll(s).forEach(el => el.remove()));
      
      const text = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 5000);

      return { 
        text, 
        title, 
        internalLinks: allLinks.filter(l => l.isInternal).slice(0, 30),
        externalLinks: allLinks.filter(l => !l.isInternal).slice(0, 10)
      };
    }, targetUrl.hostname);

    logStep(`Found ${data.internalLinks.length} internal sub-urls`);

    // 4. Screenshot (Very Memory Heavy - Only do if process is stable)
    let screenshotBase64 = '';
    try {
      if (browser.isConnected()) {
        logStep("Taking memory-safe screenshot...");
        const buffer = await page.screenshot({ type: 'jpeg', quality: 10 });
        screenshotBase64 = buffer.toString('base64');
      }
    } catch (e: any) {
      logStep(`Screenshot skipped: ${e.message}`);
    }

    logStep("Closing browser...");
    await browser.close();

    return NextResponse.json({
      url,
      status,
      ...data,
      screenshot: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64}` : null,
      debug: logs
    });

  } catch (err: any) {
    const errorTime = ((performance.now() - startTime) / 1000).toFixed(2);
    console.error(`FAILED at ${errorTime}s:`, err.message);
    
    return NextResponse.json({ 
      error: err.message, 
      at: `${errorTime}s`,
      logs: logs 
    }, { status: 500 });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}