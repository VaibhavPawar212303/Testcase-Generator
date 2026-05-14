import { NextResponse } from 'next/server';

// REQUIRED: You must set these in Vercel Dashboard for this route
export const maxDuration = 30; 

export async function POST(req: Request) {
  let browser: any = null;
  
  try {
    const { url } = await req.json();
    
    const { chromium } = await import('playwright-core');
    const sparticuzModule = await import('@sparticuz/chromium');
    const sparticuz = (sparticuzModule as any).default || sparticuzModule;
    
    const executablePath = await sparticuz.executablePath();

    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: [
        ...sparticuz.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-zygote',
      ],
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1080, height: 720 }, // Smaller viewport = less RAM
    });
    
    const page = await context.newPage();
    
    // FIX: Aggressive Blocking. 
    // Crashing is usually due to heavy images/fonts filling up the 1GB RAM limit.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media', 'manifest', 'other'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });
    
    // Step 1: Navigate with strict timeout
    try {
      // If on Vercel Hobby, total time is 10s. We must stop navigation at 7s.
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 7000 });
    } catch (e) {
      console.warn("Navigation timeout, trying to extract what we have.");
    }
    
    // Step 2: Extract content and links
    // We do this immediately. If evaluate crashes here, the page was too heavy for serverless.
    const data = await page.evaluate(() => {
      const currentUrl = window.location.href;
      const domainParts = window.location.hostname.split('.');
      const rootDomain = domainParts.length > 2 ? domainParts.slice(-2).join('.') : window.location.hostname;

      const links = Array.from(document.querySelectorAll('a'))
        .map(a => {
           try {
             const urlObj = new URL(a.href, currentUrl);
             return {
               href: urlObj.href,
               text: a.innerText.trim().slice(0, 80) || urlObj.pathname
             };
           } catch(e) { return null; }
        })
        .filter((link): link is { href: string; text: string } => {
          if (!link || !link.href) return false;
          try {
            const u = new URL(link.href);
            const isSameRootDomain = u.hostname.endsWith(rootDomain);
            const isDifferentPage = u.href.split('#')[0] !== currentUrl.split('#')[0];
            const isNotStaticAsset = !link.href.match(/\.(png|jpg|jpeg|gif|pdf|zip|gz|svg|css|js|woff|ttf)$/i);
            return isSameRootDomain && isDifferentPage && isNotStaticAsset;
          } catch(e) { return false; }
        });

      const title = document.title;
      
      // Cleanup DOM to free up memory before getting innerText
      const noisySelectors = ['script', 'style', 'noscript', 'header', 'footer', 'nav', 'aside', 'iframe'];
      noisySelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      const text = document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 10000); // Truncate text to save RAM
      
      const seen = new Set();
      const uniqueLinks = links.filter(l => {
        if (seen.has(l.href)) return false;
        seen.add(l.href);
        return true;
      });

      return { text, title, links: uniqueLinks.slice(0, 50) }; 
    });

    // Step 3: Screenshot (Optional & Risky)
    let screenshotBase64 = '';
    try {
      // Small scale and low quality to prevent OOM crash
      const screenshot = await page.screenshot({ 
        type: 'jpeg', 
        quality: 15,
        scale: 'css'
      });
      screenshotBase64 = screenshot.toString('base64');
    } catch (e) {
      console.error("Screenshot skipped to prevent memory crash");
    }

    await browser.close();
    
    return NextResponse.json({ 
      text: data.text,
      title: data.title,
      links: data.links,
      screenshot: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64}` : null
    });

  } catch (err: any) {
    console.error("Critical Scraping Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    // Final safeguard to kill the process
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}