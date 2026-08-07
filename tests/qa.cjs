const { chromium } = require("playwright");

async function inspectCanvas(page) {
  return page.locator("#world").evaluate((canvas) => {
    const context = canvas.getContext("2d");
    const { width, height } = canvas;
    const points = [];
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 18))) {
      for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 18))) {
        points.push(context.getImageData(x, y, 1, 1).data.slice(0, 3).join(","));
      }
    }
    return {
      width,
      height,
      uniqueSampleColors: new Set(points).size,
    };
  });
}

async function assertControlsInViewport(page) {
  const viewport = page.viewportSize();
  const selectors = ["#moonButton", "#soundButton", "#magicButton", "#parentButton"];
  const boxes = {};
  for (const selector of selectors) {
    boxes[selector] = await page.locator(selector).boundingBox();
    const box = boxes[selector];
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) {
      throw new Error(`${selector} is outside the viewport: ${JSON.stringify(box)}`);
    }
  }
  return boxes;
}

(async () => {
  const executablePath = process.env.BROWSER_PATH;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const errors = [];
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("http://127.0.0.1:4173", { waitUntil: "networkidle" });
  await page.waitForFunction(() => navigator.serviceWorker?.controller);
  await page.waitForTimeout(1000);
  const canvas = await inspectCanvas(page);
  if (canvas.uniqueSampleColors < 12) throw new Error(`Canvas looks blank: ${JSON.stringify(canvas)}`);
  const portraitControls = await assertControlsInViewport(page);

  await page.locator("#moonButton").tap();
  if (!(await page.locator("#moonButton").getAttribute("class")).includes("active")) {
    throw new Error("Moon mode did not activate");
  }

  await page.locator("#magicButton").tap();
  if (!(await page.locator("#toast").textContent())) throw new Error("Magic event did not run");

  await page.touchscreen.tap(195, 370);
  await page.mouse.move(195, 370);
  await page.mouse.down();
  await page.mouse.move(315, 260, { steps: 8 });
  await page.mouse.up();

  const parent = page.locator("#parentButton");
  const box = await parent.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1350);
  await page.mouse.up();
  if (!(await page.locator("#parentDialog").evaluate((dialog) => dialog.open))) {
    throw new Error("Parent long-press gate did not open");
  }
  await page.locator(".close-button").click();

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  const landscapeControls = await assertControlsInViewport(page);
  const landscapeCanvas = await inspectCanvas(page);

  await page.screenshot({ path: "tests/mobile-qa.png", fullPage: true });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

  console.log(JSON.stringify({
    canvas,
    portraitControls,
    landscapeCanvas,
    landscapeControls,
    serviceWorker: await page.evaluate(() => "serviceWorker" in navigator),
    status: "PASS",
  }, null, 2));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
