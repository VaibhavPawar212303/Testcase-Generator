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

    const browserOptions: any = {
      executablePath: executablePath || undefined,
      headless: true,
      args: [
        ...(sparticuz.args || []),
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
    };

    browser = await chromium.launch(browserOptions);
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    
    const page = await context.newPage();
    
    // speed up by avoiding heavy assets if they are not strictly needed
    // strictly speaking, we want a screenshot, so we might need images, 
    // but maybe we can skip them if it's too slow.
    // For now, let's at least block trackers/analytics
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const resourceType = route.request().resourceType();
      
      const isTracker = url.includes('google-analytics') || 
                        url.includes('doubleclick') || 
                        url.includes('facebook.net') || 
                        url.includes('segment.com');
      
      // If it's a very heavy site and we are struggling, we could block images too
      // const blockTypes = ['image', 'media', 'font'];
      const blockTypes = ['media']; 
      
      if (isTracker || blockTypes.includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Navigate with a shorter timeout and wait for DOMContentLoaded first
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
    } catch (e) {
      console.warn("Navigation timed out for domcontentloaded, attempting to proceed anyway", e);
    }
    
    // Optional: wait very briefly for stable state
    try {
      await page.waitForLoadState('load', { timeout: 2000 });
    } catch (e) {
      // Ignore load timeouts
    }
    
    // Simplified scroll to trigger some lazy loading without long waits
    await page.evaluate(() => {
      window.scrollTo(0, 1000);
      // No reset to 0 to save time, doesn't matter for scraping
    });

    // Take screenshot (optional, but keep it if expected)
    let screenshotBase64 = '';
    try {
      // Use a smaller screenshot and lower quality to save time and memory
      const screenshot = await page.screenshot({ 
        type: 'jpeg', 
        quality: 30,
        scale: 'css'
      });
      screenshotBase64 = screenshot.toString('base64');
    } catch (e) {
      console.error("Screenshot failed:", e);
    }
    
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
