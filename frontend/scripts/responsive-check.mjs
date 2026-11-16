/**
 * Responsive / a11y verification script (text output only, no visual inspection).
 * Usage: node scripts/responsive-check.mjs [baseUrl]
 */
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:5173";

const VIEWPORTS = [
  { name: "320x800 (mobile)", width: 320, height: 800 },
  { name: "375x812 (mobile)", width: 375, height: 812 },
  { name: "768x1024 (tablet)", width: 768, height: 1024 },
  { name: "1024x768 (tablet/landscape)", width: 1024, height: 768 },
  { name: "1440x900 (desktop)", width: 1440, height: 900 },
  { name: "1920x1080 (desktop)", width: 1920, height: 1080 },
];

const SEL = {
  historyPanel: 'aside[aria-label="История диалогов"]',
  debugPanel: 'aside[aria-label="Режим отладки"]',
  center: "main",
  openHistory: 'button[aria-label="Открыть историю диалогов"]',
  openDebug: 'button[aria-label="Открыть режим отладки"]',
  closeHistory: 'button[aria-label="Закрыть историю диалогов"]',
  closeDebug: 'button[aria-label="Закрыть режим отладки"]',
  textarea: 'textarea[aria-label="Поле ввода сообщения"]',
  send: 'button[aria-label="Отправить сообщение"]',
  bubbles: "[class*='bubble']",
  bodies: "[class*='body']",
};

function r(rect) {
  return `x=${Math.round(rect.x)} y=${Math.round(rect.y)} w=${Math.round(rect.width)} h=${Math.round(rect.height)}`;
}

function overlap(a, b) {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH,
  channel: process.env.CHROME_PATH ? undefined : "msedge",
});
let totalProblems = 0;

for (const vp of VIEWPORTS) {
  const isDesktop = vp.width >= 1280;
  const problems = [];
  const consoleErrors = [];
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(BASE, { waitUntil: "networkidle" });
  console.log(`\n=== ${vp.name} ===`);

  // 1. Horizontal scroll
  const scroll = await page.evaluate(() => ({
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    innerW: window.innerWidth,
    docClientW: document.documentElement.clientWidth,
  }));
  console.log(
    `scrollWidth: doc=${scroll.docScrollW} body=${scroll.bodyScrollW} | innerWidth=${scroll.innerW} clientWidth=${scroll.docClientW}`
  );
  if (scroll.docScrollW > scroll.innerW)
    problems.push(`Horizontal scroll: doc.scrollWidth ${scroll.docScrollW} > innerWidth ${scroll.innerW}`);

  // 2. Panel rects & visibility
  const panels = await page.evaluate((sel) => {
    const grab = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        display: cs.display,
        position: cs.position,
        transform: cs.transform,
        visibility: cs.visibility,
        ariaHidden: el.getAttribute("aria-hidden"),
        offsetParent: el.offsetParent !== null,
      };
    };
    return {
      history: grab(sel.historyPanel),
      center: grab(sel.center),
      debug: grab(sel.debugPanel),
    };
  }, SEL);

  console.log(
    `history: ${panels.history ? `${r(panels.history.rect)} pos=${panels.history.position} visibility=${panels.history.visibility} ariaHidden=${panels.history.ariaHidden}` : "MISSING"}`
  );
  console.log(
    `chat:    ${panels.center ? r(panels.center.rect) : "MISSING"}`
  );
  console.log(
    `debug:   ${panels.debug ? `${r(panels.debug.rect)} pos=${panels.debug.position} visibility=${panels.debug.visibility} ariaHidden=${panels.debug.ariaHidden}` : "MISSING"}`
  );

  // Visible side panels on desktop must all be on screen
  if (isDesktop) {
    if (!panels.history || panels.history.rect.width === 0) problems.push("Desktop: history panel not visible");
    if (!panels.debug || panels.debug.rect.width === 0) problems.push("Desktop: debug panel not visible");
    if (panels.history && (panels.history.rect.x < 0 || panels.history.ariaHidden === "true"))
      problems.push("Desktop: history panel off-screen or aria-hidden");
    if (panels.debug && panels.debug.ariaHidden === "true")
      problems.push("Desktop: debug panel aria-hidden");
  } else {
    if (panels.history && panels.history.ariaHidden !== "true" && panels.history.rect.x > -10)
      console.log("note: history drawer already open at load");
    if (panels.debug && panels.debug.ariaHidden !== "true")
      problems.push("Closed debug drawer should be aria-hidden on non-desktop");
    if (panels.history && panels.history.visibility !== "hidden")
      problems.push("Closed history drawer must have visibility:hidden (out of Tab order)");
    if (panels.debug && panels.debug.visibility !== "hidden")
      problems.push("Closed debug drawer must have visibility:hidden (out of Tab order)");
  }

  // 3. Overlap of visible panels
  const vis = [panels.history, panels.center, panels.debug].filter(
    (p) => p && p.rect.width > 0 && p.rect.height > 0 && p.ariaHidden !== "true"
  );
  for (let i = 0; i < vis.length; i++) {
    for (let j = i + 1; j < vis.length; j++) {
      if (overlap(vis[i].rect, vis[j].rect)) {
        problems.push(`Panel overlap between panels ${i} and ${j}: ${r(vis[i].rect)} vs ${r(vis[j].rect)}`);
      }
    }
  }

  // 4. Interactive controls (visibility check excludes closed drawers)
  const controls = await page.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    const els = Array.from(document.querySelectorAll("button, textarea, a[href]")).filter(isVisible);
    return els.map((el, index) => {
      const r = el.getBoundingClientRect();
      return {
        index,
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? "",
        w: Math.round(r.width),
        h: Math.round(r.height),
      };
    });
  });
  console.log(
    `interactive: ${controls.map((c) => `${c.tag} "${c.label}" ${c.w}x${c.h}`).join("; ")}`
  );
  for (const c of controls) {
    if (c.w < 24 || c.h < 24) {
      // The button may have an extended invisible hit area via pseudo-elements.
      // Verify pointer events 12px outside the border box still land on the button.
      const hitAreaOk = await page.evaluate((idx) => {
        const visible = Array.from(
          document.querySelectorAll("button, textarea, a[href]")
        ).filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        });
        const el = visible[idx];
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const points = [
          [r.x - 10, cy],
          [r.x + r.width + 10, cy],
          [cx, r.y - 10],
          [cx, r.y + r.height + 10],
        ];
        return points.every(([x, y]) => {
          if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return true;
          const hit = document.elementFromPoint(x, y);
          return hit === el || (hit && el.contains(hit));
        });
      }, c.index);
      if (hitAreaOk) {
        console.log(
          `  note: ${c.tag} "${c.label}" ${c.w}x${c.h} visual, extended hit area >= 24px confirmed via elementFromPoint`
        );
      } else {
        problems.push(
          `Control too small: ${c.tag} "${c.label}" ${c.w}x${c.h} (<24px WCAG 2.5.8 target, no extended hit area)`
        );
      }
    }
  }
  if (vp.width < 768) {
    for (const c of controls) {
      if (c.tag === "button" && (c.w < 40 || c.h < 40))
        problems.push(`Mobile touch target small: ${c.tag} "${c.label}" ${c.w}x${c.h} (<40px)`);
    }
  }

  // 5. Message overflow / truncation
  const msg = await page.evaluate(
    ({ bubbles, bodies }) => {
      const inner = document.querySelector("main")?.getBoundingClientRect();
      const res = { count: document.querySelectorAll(bubbles).length, overflows: [], longestWordOk: true };
      document.querySelectorAll(bodies).forEach((b) => {
        const r = b.getBoundingClientRect();
        if (inner && (r.right > inner.right + 1 || r.left < inner.left - 1))
          res.overflows.push(`bubble out of chat area: x=${Math.round(r.x)} right=${Math.round(r.right)}`);
        const cs = getComputedStyle(b);
        if (cs.overflowWrap !== "anywhere" && cs.wordBreak === "normal") res.longestWordOk = false;
      });
      return res;
    },
    { bubbles: SEL.bubbles, bodies: SEL.bodies }
  );
  console.log(
    `messages: bubbles=${msg.count}, outOfChatArea=${msg.overflows.length}, longWordWrap=${msg.longestWordOk}`
  );
  if (msg.overflows.length) problems.push(...msg.overflows.slice(0, 3));
  if (!msg.longestWordOk) problems.push("Message body lacks overflow-wrap for long unbroken words");

  // 6. Drawers (non-desktop): open history, Escape, focus restore; open debug, close
  if (!isDesktop) {
    const openBtn = page.locator(SEL.openHistory);
    await openBtn.focus();
    await openBtn.click();
    await page.waitForTimeout(350); // transition
    const histOpen = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), ariaHidden: el.getAttribute("aria-hidden") };
    }, SEL.historyPanel);
    console.log(`drawer history opened: x=${histOpen.x} ariaHidden=${histOpen.ariaHidden}`);
    if (histOpen.x !== 0 || histOpen.ariaHidden === "true")
      problems.push(`History drawer did not open fully: x=${histOpen.x} ariaHidden=${histOpen.ariaHidden}`);

    // focused element inside drawer?
    const focusInDrawer = await page.evaluate(
      (s) => document.querySelector(s)?.contains(document.activeElement),
      SEL.historyPanel
    );
    if (!focusInDrawer) problems.push("Focus not moved into history drawer on open");

    // horizontal scroll while drawer open
    const swOpen = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (swOpen > 0) problems.push(`Horizontal scroll with drawer open: ${swOpen}px`);

    // keyboard trap: Tab cycles inside drawer
    const trapOk = await page.evaluate((s) => {
      const panel = document.querySelector(s);
      const focusables = panel.querySelectorAll("button, textarea, input, a[href]");
      return focusables.length > 0;
    }, SEL.historyPanel);
    if (!trapOk) problems.push("No focusable elements inside history drawer (Tab trap empty)");
    else {
      // press Tab 6 times, focus must remain in drawer
      for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
      const stillInside = await page.evaluate(
        (s) => document.querySelector(s)?.contains(document.activeElement),
        SEL.historyPanel
      );
      if (!stillInside) problems.push("Tab focus escaped the history drawer");
    }

    await page.keyboard.press("Escape");
    await page.waitForTimeout(350);
    const histClosed = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), ariaHidden: el.getAttribute("aria-hidden") };
    }, SEL.historyPanel);
    const focusBack = await page.evaluate(
      () => document.activeElement?.getAttribute("aria-label") === "Открыть историю диалогов"
    );
    console.log(
      `drawer history closed: x=${histClosed.x} ariaHidden=${histClosed.ariaHidden}, focus restored=${focusBack}`
    );
    if (histClosed.x >= 0 || histClosed.ariaHidden !== "true")
      problems.push(`History drawer did not close properly: x=${histClosed.x} ariaHidden=${histClosed.ariaHidden}`);
    if (!focusBack) problems.push("Focus not restored to history trigger after Escape");

    // Debug drawer
    await page.click(SEL.openDebug);
    await page.waitForTimeout(350);
    const dbg = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), innerW: window.innerWidth };
    }, SEL.debugPanel);
    console.log(`drawer debug opened: x=${dbg.x} w=${dbg.w} innerW=${dbg.innerW}`);
    if (dbg.x + dbg.w !== dbg.innerW || dbg.x < 0)
      problems.push(`Debug drawer position wrong: x=${dbg.x} w=${dbg.w} innerW=${dbg.innerW}`);
    const swDbg = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (swDbg > 0) problems.push(`Horizontal scroll with debug drawer open: ${swDbg}px`);
    // close via its close button (test visible close control)
    const hasClose = await page.locator(SEL.closeDebug).count();
    if (!hasClose) problems.push("Debug drawer has no visible close button");
    else {
      await page.click(SEL.closeDebug);
      await page.waitForTimeout(350);
      const dbgClosed = await page.evaluate((s) => {
        const el = document.querySelector(s);
        return { ariaHidden: el.getAttribute("aria-hidden"), x: Math.round(el.getBoundingClientRect().x) };
      }, SEL.debugPanel);
      if (dbgClosed.ariaHidden !== "true")
        problems.push(`Debug drawer did not close via button: ariaHidden=${dbgClosed.ariaHidden}`);
    }
  } else {
    // Desktop: keyboard navigation sanity — Tab reaches textarea and send button
    await page.keyboard.press("Tab");
    const firstFocus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      label: document.activeElement?.getAttribute("aria-label"),
    }));
    console.log(`first Tab focus: ${firstFocus.tag} "${firstFocus.label}"`);
    if (firstFocus.tag !== "BUTTON") problems.push(`First Tab focus is not a button: ${firstFocus.tag}`);

    await page.locator(SEL.textarea).focus();
    const taRect = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }, SEL.textarea);
    console.log(`textarea on desktop: ${taRect.w}x${taRect.h}`);
  }

  // 7. Composer usable: textarea fully inside viewport
  const ta = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, right: r.right, bottom: r.bottom, innerW: window.innerWidth, innerH: window.innerHeight };
  }, SEL.textarea);
  if (ta) {
    console.log(`textarea rect: x=${Math.round(ta.x)} right=${Math.round(ta.right)} bottom=${Math.round(ta.bottom)}`);
    if (ta.right > ta.innerW + 1 || ta.bottom > ta.innerH + 1)
      problems.push(`Textarea outside viewport: right=${Math.round(ta.right)} bottom=${Math.round(ta.bottom)}`);
  } else {
    problems.push("Message textarea not found");
  }

  // 8. Console errors
  if (consoleErrors.length) {
    problems.push(`Console errors (${consoleErrors.length}): ${consoleErrors.slice(0, 3).join(" | ")}`);
  }
  console.log(consoleErrors.length ? `console errors: ${consoleErrors.length}` : "console: clean");

  console.log(problems.length ? `PROBLEMS (${problems.length}):` : "RESULT: OK");
  problems.forEach((p) => console.log(`  - ${p}`));
  totalProblems += problems.length;

  // Screenshot for manual review only (not opened by the model)
  await page.screenshot({ path: `docs/responsive/check-${vp.width}x${vp.height}.png` });
  await context.close();
}

await browser.close();
console.log(`\nTOTAL PROBLEMS: ${totalProblems}`);
process.exit(totalProblems > 0 ? 1 : 0);
