import { NextResponse } from 'next/server';

// FIX: Increase timeout and memory for serverless environment
// Vercel: maxDuration is in seconds. memory is in MB.
export const maxDuration = 30; 
export const memory = 1024; // Ensure at least 1GB RAM

export async function POST(req: Request) {
  let browser: any; // Use any to avoid type conflicts with dynamic imports
  try {
    const { url } = await req.json();
    
    const { chromium } = await import('playwright-core');
    const sparticuzModule = await import('@sparticuz/chromium');
    const sparticuz = (sparticuzModule as any).default || sparticuzModule;
    
    let executablePath;
    try {
      executablePath = await sparticuz.executablePath();
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
    
    await page.route('**/*', (route) => {
      const requestUrl = route.request().url();
      const resourceType = route.request().resourceType();
      
      const isTracker = requestUrl.includes('google-analytics') || 
                        requestUrl.includes('doubleclick') || 
                        requestUrl.includes('facebook.net') || 
                        requestUrl.includes('segment.com');
      
      const blockTypes = ['media']; 
      
      if (isTracker || blockTypes.includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Step 1: Navigate
    try {
      // Increased timeout slightly to 15s for stability
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      console.warn("Navigation timed out, proceeding with current state", e);
    }
    
    try {
      await page.waitForLoadState('load', { timeout: 3000 });
    } catch (e) {}

    // Step 2: Extract content and links (Do this BEFORE screenshot to save memory)
    const data = await page.evaluate(() => {
      const currentUrl = window.location.href;
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
            const isSameRootDomain = url.hostname.endsWith(rootDomain);
            const isDifferentPage = url.href.split('#')[0] !== currentUrl.split('#')[0];
            const isNotStaticAsset = !link.href.match(/\.(png|jpg|jpeg|gif|pdf|zip|gz|svg|css|js|woff|ttf)$/i);
            const isNotMailOrTel = !link.href.startsWith('mailto:') && !link.href.startsWith('tel:');
            return isSameRootDomain && isDifferentPage && isNotStaticAsset && isNotMailOrTel;
          } catch(e) { return false; }
        });

      const title = document.title;
      const noisySelectors = ['script', 'style', 'noscript', 'header', 'footer', 'nav', 'aside', 'iframe', 'button:not([href])'];
      noisySelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      const text = document.body.innerText.replace(/\s+/g, ' ').trim();
      const seen = new Set();
      const uniqueLinks = links.filter(l => {
        if (seen.has(l.href)) return false;
        seen.add(l.href);
        return true;
      });

      return { text, title, links: uniqueLinks.slice(0, 100) }; 
    });

    // Step 3: Screenshot (Memory intensive, we do this last)
    let screenshotBase64 = '';
    // Check if page is still open before screenshotting
    if (!page.isClosed()) {
      try {
        const screenshot = await page.screenshot({ 
          type: 'jpeg', 
          quality: 20, // Lower quality significantly reduces RAM spikes
          scale: 'css'
        });
        screenshotBase64 = screenshot.toString('base64');
      } catch (e) {
        console.error("Screenshot failed, continuing with data only:", e);
      }
    }

    // Success response
    return NextResponse.json({ 
      text: data.text,
      title: data.title,
      links: data.links,
      screenshot: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64}` : null
    });

  } catch (err) {
    console.error("Scraping error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    // FIX: Ensure browser always closes even on failures to prevent OOM in future runs
    if (browser) {
      await browser.close();
    }
  }
}