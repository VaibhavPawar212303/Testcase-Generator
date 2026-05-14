import { NextResponse } from 'next/server';

// Next.js valid export for Vercel Pro/Enterprise. 
// NOTE: Memory must be set in the Vercel Dashboard (Option 1)
export const maxDuration = 30; 

export async function POST(req: Request) {
  let browser: any = null;
  
  try {
    const { url } = await req.json();
    
    // Serverless-friendly browser launch
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
        '--single-process', // Standard for serverless to save RAM
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
      
      // Block media and fonts to save memory (Target Closed is often an OOM error)
      const blockTypes = ['media', 'font']; 
      
      if (isTracker || blockTypes.includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Step 1: Navigate
    try {
      // Shorter timeout to leave time for processing
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    } catch (e) {
      console.warn("Navigation timed out, attempting to proceed with data extraction...");
    }
    
    // Wait briefly for hydration
    try {
      await page.waitForLoadState('load', { timeout: 2000 });
    } catch (e) {}
    
    // Simplified scroll
    await page.evaluate(() => {
      window.scrollTo(0, 500);
    }).catch(() => {});

    // Step 2: Extract content and links (FIRST - while memory is stable)
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

    // Step 3: Screenshot (LAST - this is where RAM usually spikes)
    let screenshotBase64 = '';
    try {
      // Added a check: only screenshot if browser is still responsive
      const screenshot = await page.screenshot({ 
        type: 'jpeg', 
        quality: 20, // Lower quality significantly reduces risk of RAM crash
        scale: 'css'
      });
      screenshotBase64 = screenshot.toString('base64');
    } catch (e) {
      console.error("Screenshot failed, returning text data only:", e.message);
    }

    await browser.close();
    
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
    // CRITICAL: Guaranteed cleanup to prevent memory leaks in the serverless container
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Browser might already be closed
      }
    }
  }
}