import { NextResponse } from 'next/server';

export const maxDuration = 60; // 60 seconds (requires Pro plan on Vercel, but helps on many platforms)
export const dynamic = 'force-dynamic';

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
    const { chromium } = await import('playwright-core');
    let sparticuz;
    
    const launchBrowser = async () => {
      try {
        const sparticuzModule = await import('@sparticuz/chromium-min');
        sparticuz = (sparticuzModule as any).default || sparticuzModule;
        
        console.log("Attempting sparticuz-chromium-min launch...");
        const executablePath = await sparticuz.executablePath('https://github.com/sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar');
        
        return await chromium.launch({
          executablePath,
          args: Array.isArray(sparticuz.args) ? [...sparticuz.args, '--disable-blink-features=AutomationControlled'] : sparticuz.args,
          headless: sparticuz.headless === true || String(sparticuz.headless) === 'true' || sparticuz.headless === 'shell',
        });
      } catch (e) {
        console.warn("Sparticuz launch failed, trying local chromium:", e);
        return await chromium.launch({
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
          headless: true
        });
      }
    };

    try {
      browser = await launchBrowser();
    } catch (launchError) {
      console.warn("Browser launch totally failed. Attempting Cheerio fallback...", launchError);
      
      // Cheerio Fallback for basic HTML scraping (prevents total failure on 4th+ URL if env flakes)
      try {
        const axiosModule = await import('axios');
        const axios = axiosModule.default || axiosModule;
        const cheerioModule = await import('cheerio');
        const cheerio = cheerioModule.default || cheerioModule;
        
        const response = await axios.get(url, { 
          timeout: 10000,
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          }
        });
        
        const $ = (cheerio.load || cheerio)(response.data);
        
        // Remove noise
        $('script, style, noscript, nav, footer, header', 'body').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        const title = $('title').text() || url;
        const links: { href: string; text: string }[] = [];
        
        const baseUrl = new URL(url).origin;
        $('a[href]', 'body').each((_, el) => {
          const href = $(el).attr('href');
          if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            try {
              const fullUrl = new URL(href, url).href;
              if (fullUrl.startsWith(baseUrl)) {
                links.push({ href: fullUrl, text: $(el).text().trim().slice(0, 50) });
              }
            } catch(e) {}
          }
        });

        return NextResponse.json({
          text: text.slice(0, 50000), // Limit text size for JSON stability
          title,
          links: Array.from(new Set(links.map(l => l.href))).map(href => links.find(l => l.href === href)).slice(0, 50),
          screenshot: null,
          fallback: true
        });
      } catch (cheerioError) {
        throw new Error(`Browser failed AND Cheerio fallback failed: ${(cheerioError as Error).message}`);
      }
    }
    
    // Add randomness to UA
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
    const userAgent = uas[Math.floor(Math.random() * uas.length)];

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      }
    });
    
    const page = await context.newPage();
    
    // Navigate and wait for loading - FASTER for serverless
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      // Minor wait for some hydration
      await page.waitForTimeout(1000);
    } catch (e) {
      console.warn("Initial load timed out, attempting proceed...", e);
    }
    
    // Quick scroll
    await page.evaluate(async () => {
      window.scrollBy(0, 2000);
      await new Promise(r => setTimeout(r, 500));
      window.scrollTo(0, 0);
    });

    // VALIDATION
    const checkStatus = await page.evaluate(() => {
      const text = document.body?.innerText || "";
      const isBlocked = text.includes("Access Denied") || text.includes("Cloudflare") || document.title.includes("Attention Required");
      return { isBlocked, textLength: text.length };
    });

    if (checkStatus.isBlocked) {
      throw new Error("Target site blocked the scraper (Bot detection).");
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

    // CRITICAL: Explicit cleanup
    await page.close();
    await context.close();
    await browser.close();
    browser = null;
    
    return NextResponse.json({ 
      text: data.text,
      title: data.title,
      links: data.links,
      screenshot: `data:image/jpeg;base64,${screenshotBase64}`
    });
  } catch (err) {
    console.error("Scraping error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    if (browser) {
      try {
        await (browser as any).close();
      } catch (e) {
        console.error("Error closing browser in finally:", e);
      }
    }
  }
}
