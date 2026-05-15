import { NextResponse } from 'next/server';

// Next.js valid export for Vercel Pro/Enterprise. 
export const maxDuration = 60; 

export async function POST(req: Request) {
  let browser: any = null;
  
  try {
    const { url } = await req.json();
    
    if (!url || !url.startsWith('http')) {
      return NextResponse.json({ error: "Invalid URL provided" }, { status: 400 });
    }
    
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
        '--single-process', 
        '--disable-extensions',
        '--proxy-server="direct://"',
        '--proxy-bypass-list=*'
      ],
    };

    browser = await chromium.launch(browserOptions);
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1024, height: 768 }, // Slightly smaller viewport to save RAM
    });
    
    const page = await context.newPage();
    
    // EXTREMELY CRITICAL: Block heavy resources to prevent "Target Closed" (OOM)
    await page.route('**/*', (route) => {
      const requestUrl = route.request().url();
      const resourceType = route.request().resourceType();
      
      const isTracker = requestUrl.includes('analytics') || 
                        requestUrl.includes('ads') || 
                        requestUrl.includes('facebook') || 
                        requestUrl.includes('pixel');
      
      // Blocking 'image' is the single most effective way to prevent OOM crashes
      const blockTypes = ['image', 'media', 'font', 'other']; 
      
      if (isTracker || blockTypes.includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });
    
    // Step 1: Navigate with optimized waiting
    try {
      // 'domcontentloaded' is much faster than 'load'
      await page.goto(url, { 
        waitUntil: 'domcontentloaded', 
        timeout: 20000 // 20s for initial load
      });
    } catch (e) {
      console.warn("Initial navigation timeout, attempting to proceed...");
    }
    
    // Optional: wait briefly for network to settle slightly 
    try {
      await page.waitForLoadState('load', { timeout: 3000 });
    } catch (e) {
      console.warn("Load state not reached, proceeding with current content.");
    }
    
    // Step 2: Extract content and links WHILE the page is stable
    const data = await page.evaluate(() => {
      try {
        const currentUrl = window.location.href;
        const domainParts = window.location.hostname.split('.');
        const rootDomain = domainParts.length > 2 ? domainParts.slice(-2).join('.') : window.location.hostname;

        // Links extraction
        const links = Array.from(document.querySelectorAll('a'))
          .map(a => {
             try {
               const url = new URL(a.href, currentUrl);
               return {
                 href: url.href,
                 text: (a.innerText || "").trim().slice(0, 100) || url.pathname
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

        const title = document.title || "No Title";
        
        // Clean the DOM minimally to save memory during innerText call
        const noisySelectors = ['script', 'style', 'noscript', 'iframe', 'svg', 'path'];
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

        return { text, title, links: uniqueLinks.slice(0, 50) }; 
      } catch (innerErr) {
        return { text: "Extraction failed inside evaluate", title: "Error", links: [] };
      }
    });

    // Step 3: Screenshot (Only if memory allows - we use high compression)
    let screenshotBase64 = '';
    try {
      const screenshot = await page.screenshot({ 
        type: 'jpeg', 
        quality: 15, // Extremely high compression to avoid RAM spikes
        scale: 'css'
      });
      screenshotBase64 = screenshot.toString('base64');
    } catch (e) {
      console.error("Screenshot skipped due to memory/state issues:", (e as Error).message);
    }

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