import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let browser;
  try {
    const { url } = await req.json();
    
    // Serverless-friendly browser launch
    const { chromium } = await import('playwright-core');
    const sparticuzModule = await import('@sparticuz/chromium');
    const sparticuz = (sparticuzModule as any).default || sparticuzModule;
    
    // Detect environment
    let executablePath;
    try {
      executablePath = await sparticuz.executablePath();
      console.log("Using Chromium executable at:", executablePath);
    } catch (e) {
      console.error("Failed to get sparticuz executable path:", e);
    }

    browser = await chromium.launch({
      executablePath: executablePath || undefined,
      headless: true, // Force headless for server environments
      args: [
        ...(sparticuz.args || []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process' // Helps in restricted memory environments
      ],
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    
    const page = await context.newPage();
    
    // Set a reasonable viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    
    // Navigate and wait for network idle
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    
    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 100;
        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight || totalHeight > 10000) {
            clearInterval(timer);
            resolve(true);
          }
        }, 100);
      });
    });

    // Wait extra for dynamic content after scroll
    await page.waitForTimeout(2000);
    
    // Take screenshot
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 50 });
    const screenshotBase64 = screenshot.toString('base64');
    
    // Extract content and links
    const data = await page.evaluate(() => {
      // 1. Extract internal links BEFORE cleanup
      const currentUrl = window.location.href;
      const baseUrl = window.location.origin;
      const domainParts = window.location.hostname.split('.');
      const rootDomain = domainParts.length > 2 ? domainParts.slice(-2).join('.') : window.location.hostname;

      const links = Array.from(document.querySelectorAll('a'))
        .map(a => {
           try {
             const url = new URL(a.href, currentUrl);
             return {
               href: url.href,
               text: a.innerText.trim().slice(0, 100) || url.pathname
             };
           } catch(e) { return null; }
        })
        .filter((link): link is { href: string; text: string } => {
          if (!link || !link.href) return false;
          try {
            const url = new URL(link.href);
            // Allow same origin OR same root domain for docs that cross subdomains
            const isSameRootDomain = url.hostname.endsWith(rootDomain);
            const isDifferentPage = url.href.split('#')[0] !== currentUrl.split('#')[0];
            const isNotStaticAsset = !link.href.match(/\.(png|jpg|jpeg|gif|pdf|zip|gz|svg|css|js|woff|ttf)$/i);
            const isNotMailOrTel = !link.href.startsWith('mailto:') && !link.href.startsWith('tel:');
            
            return isSameRootDomain && isDifferentPage && isNotStaticAsset && isNotMailOrTel;
          } catch(e) { return false; }
        });

      const title = document.title;

      // 2. Cleanup for text extraction
      const noisySelectors = ['script', 'style', 'noscript', 'header', 'footer', 'nav', 'aside', 'iframe', 'button:not([href])'];
      noisySelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      const text = document.body.innerText.replace(/\s+/g, ' ').trim();
      
      // Deduplicate by href
      const seen = new Set();
      const uniqueLinks = links.filter(l => {
        if (seen.has(l.href)) return false;
        seen.add(l.href);
        return true;
      });

      return { text, title, links: uniqueLinks.slice(0, 100) }; 
    });

    await browser.close();
    
    return NextResponse.json({ 
      text: data.text,
      title: data.title,
      links: data.links,
      screenshot: `data:image/jpeg;base64,${screenshotBase64}`
    });
  } catch (err) {
    if (browser) await browser.close();
    console.error("Scraping error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
