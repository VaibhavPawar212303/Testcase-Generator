import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let browser;
  try {
    const { url } = await req.json();
    
    // Dynamic import to avoid build-time issues with Playwright
    const { chromium } = await import('playwright');
    
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
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
