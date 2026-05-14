import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  let browser;
  try {
    const body = await req.json().catch(() => ({}));
    const { url } = body;
    
    if (!url) {
      return NextResponse.json({ error: "Missing URL in request body" }, { status: 400 });
    }

    console.log(`Starting scrap for URL: ${url}`);
    
    // Detect environment and launch browser
    const { chromium } = await import('playwright');
    
    try {
      console.log("Attempting standard chromium launch via playwright package...");
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
      });
    } catch (launchError) {
      console.warn("Standard launch failed, trying with playwright-core + sparticuz:", launchError);
      try {
        const { chromium: chromiumCore } = await import('playwright-core');
        const sparticuzModule = await import('@sparticuz/chromium');
        const sparticuz = (sparticuzModule as any).default || sparticuzModule;
        const executablePath = await sparticuz.executablePath();
        
        browser = await chromiumCore.launch({
          executablePath,
          args: sparticuz.args,
          headless: sparticuz.headless,
          handleSIGINT: false,
          handleSIGTERM: false,
          handleSIGHUP: false
        });
      } catch (sparticuzError) {
        console.error("All launch methods failed:", sparticuzError);
        throw new Error(`CRITICAL: Browser launch failed. Environment missing dependencies or Chromium binary. Details: ${(launchError as Error).message}`);
      }
    }
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    
    const page = await context.newPage();
    
    // Navigate and wait for loading
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      // Add networkidle as a secondary wait state but capped
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => console.log("Network idle timeout, proceeding..."));
    } catch (e) {
      console.warn("Initial load failed/timed out, checking if body exists...", e);
    }
    
    // Scroll down to trigger lazy loading
    await page.evaluate(async () => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 200; // Faster scroll
        const timer = setInterval(() => {
          const body = document.body;
          if (!body) {
            clearInterval(timer);
            return resolve(true);
          }
          const scrollHeight = body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= scrollHeight || totalHeight > 5000) {
            clearInterval(timer);
            resolve(true);
          }
        }, 100);
      });
    });

    // Wait extra for dynamic content after scroll
    await page.waitForTimeout(1500);

    // EXTENSIVE VALIDATION BEFORE EXTRACTION
    // Check if the page is behind a challenge/spinner or empty
    const checkStatus = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const isSpinner = !!document.querySelector('.spinner, .loading, #loader, [class*="Loading"]');
      const isEmpty = text.length < 100;
      return { isSpinner, isEmpty, textLength: text.length };
    });

    if (checkStatus.isSpinner || checkStatus.isEmpty) {
      console.log(`Detected possible loading state or empty page (Length: ${checkStatus.textLength}). Waiting 3 more seconds...`);
      await page.waitForTimeout(3000);
    }
    
    // Take screenshot (reduced quality to save memory)
    const screenshot = await page.screenshot({ type: 'jpeg', quality: 30 });
    const screenshotBase64 = screenshot.toString('base64');
    
    // Extract content and links
    const data = await page.evaluate(() => {
      if (!document.body) return { text: '', title: '', links: [] };
      
      const getMeaningfulText = (el: HTMLElement) => {
        const text = el.innerText.replace(/\s+/g, ' ').trim();
        return text;
      };

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
            const isSameRootDomain = url.hostname.endsWith(rootDomain);
            const isDifferentPage = url.href.split('#')[0] !== currentUrl.split('#')[0];
            const isNotStaticAsset = !link.href.match(/\.(png|jpg|jpeg|gif|pdf|zip|gz|svg|css|js|woff|ttf|ico)$/i);
            const isNotMailOrTel = !link.href.startsWith('mailto:') && !link.href.startsWith('tel:');
            
            return isSameRootDomain && isDifferentPage && isNotStaticAsset && isNotMailOrTel;
          } catch(e) { return false; }
        });

      const title = document.title;

      // 2. Cleanup for text extraction
      const noisySelectors = ['script', 'style', 'noscript', 'header', 'footer', 'nav', 'aside', 'iframe', 'svg', 'button:not([href])'];
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

      return { text, title, links: uniqueLinks.slice(0, 50) }; 
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
