import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let browser;
  try {
    const { url } = await req.json();
    
    // Serverless-friendly browser launch
    const { chromium } = await import('playwright-core');
    const sparticuzChromium = await import('@sparticuz/chromium');
    
    // Detect if we are in a serverless environment (like Vercel)
    const isServerless = !!(process.env.VERCEL || process.env.AWS_EXECUTION_ENV); 

    browser = await chromium.launch({
      // For Vercel, we use sparticuz chromium. 
      // For local development or this container, we fallback to standard playwright if executablePath is undefined.
      executablePath: isServerless ? await (sparticuzChromium as any).executablePath() : undefined,
      headless: isServerless ? (sparticuzChromium as any).headless : true,
      args: isServerless ? (sparticuzChromium as any).args : ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    
    const page = await context.newPage();
    
    // Set a reasonable viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    
    // Navigate and wait for network idle
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Optional: Wait extra for dynamic content
    await page.waitForTimeout(2000);
    
    // Take screenshot
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
    const screenshotBase64 = screenshot.toString('base64');
    
    // Extract content
    const text = await page.evaluate(() => {
      // Remove noisy elements
      const scripts = document.querySelectorAll('script, style, nav, footer, header, noscript');
      scripts.forEach(s => s.remove());
      return document.body.innerText.replace(/\s+/g, ' ').trim();
    });

    await browser.close();
    
    return NextResponse.json({ 
      text, 
      screenshot: `data:image/jpeg;base64,${screenshotBase64}`
    });
  } catch (err) {
    if (browser) await browser.close();
    console.error("Scraping error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
