const { chromium } = require("playwright");

let browser;

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

async function inspectSleepGhost(page) {
  return page.locator("#sleepGhost").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    let transparent = 0;
    let green = 0;
    for (let offset = 0; offset < data.length; offset += 16) {
      const red = data[offset];
      const greenChannel = data[offset + 1];
      const blue = data[offset + 2];
      const alpha = data[offset + 3];
      if (alpha > 16) visible += 1;
      else transparent += 1;
      if (alpha > 16 && greenChannel > red + 35 && greenChannel > blue + 35) green += 1;
    }
    return { visible, transparent, green };
  });
}

async function countSoftWhitePixels(page) {
  return page.locator("#world").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let offset = 0; offset < data.length; offset += 16) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      if (red > 180 && green > 180 && blue > 180 && Math.max(red, green, blue) - Math.min(red, green, blue) < 38) count += 1;
    }
    return count;
  });
}
async function countMagicPixels(page, region, kind) {
  return page.locator("#world").evaluate((canvas, { region, kind }) => {
    const context = canvas.getContext("2d");
    const startY = Math.floor(canvas.height * region[0]);
    const endY = Math.floor(canvas.height * region[1]);
    const data = context.getImageData(0, startY, canvas.width, endY - startY).data;
    let count = 0;
    for (let offset = 0; offset < data.length; offset += 4) {
      const red = data[offset];
      const green = data[offset + 1];
      const blue = data[offset + 2];
      const cyan = blue > 150 && green > 145 && blue - red > 24;
      const pink = red > 165 && blue > 140 && red - green > 12;
      const yellow = red > 175 && green > 155 && red - blue > 38;
      const coral = red > 175 && green > 70 && green < 170 && red - blue > 45;
      if (kind === "bubble" ? (cyan || pink || yellow) : (cyan || yellow || coral)) count += 1;
    }
    return count;
  }, { region, kind });
}

async function triggerSyntheticShake(page) {
  await page.evaluate(async () => {
    const fire = (x, y, z) => {
      const event = new Event("devicemotion");
      Object.defineProperty(event, "acceleration", { value: { x, y, z } });
      window.dispatchEvent(event);
    };
    fire(0, 0, 0);
    await new Promise((resolve) => setTimeout(resolve, 120));
    fire(15, -13, 8);
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
  browser = await chromium.launch({
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
  await page.waitForFunction(() => document.querySelector("#sleepGhost")?.classList.contains("ready"));
  await page.waitForTimeout(1000);
  const canvas = await inspectCanvas(page);
  if (canvas.uniqueSampleColors < 12) throw new Error(`Canvas looks blank: ${JSON.stringify(canvas)}`);
  const sleepGhost = await inspectSleepGhost(page);
  if (sleepGhost.visible < 5000 || sleepGhost.transparent < 5000 || sleepGhost.green > 20) {
    throw new Error(`Sleeping ghost chroma key failed: ${JSON.stringify(sleepGhost)}`);
  }
  const appSource = await page.evaluate(() => fetch("app.js?v=8").then((response) => response.text()));
  for (const marker of [
    "const count = width < 500 ? 3 : 4;",
    "for (let i = 0; i < 12; i += 1)",
    "kind: \"falling-star\"",
    "p.y < height * 0.06",
    "Math.min(width * 0.94, height * 0.88) / 1.48",
    "{ popIn: true }",
    "ghost.dizzyUntil = now + 3000",
    "window.addEventListener(\"devicemotion\", handleDeviceMotion)",
  ]) {
    if (!appSource.includes(marker)) throw new Error(`Missing iteration marker: ${marker}`);
  }
  const portraitControls = await assertControlsInViewport(page);
  await page.locator("#sleepCurtain").evaluate((element) => { element.hidden = false; });
  const sleepLayout = {
    ghost: await page.locator("#sleepGhost").boundingBox(),
    message: await page.locator("#sleepCurtain p").boundingBox(),
    moon: await page.locator(".sleep-moon").boundingBox(),
  };
  if (!sleepLayout.ghost || !sleepLayout.message || !sleepLayout.moon
      || sleepLayout.ghost.y + sleepLayout.ghost.height > sleepLayout.message.y
      || sleepLayout.message.y + sleepLayout.message.height > 844) {
    throw new Error(`Sleep layout overlaps or overflows: ${JSON.stringify(sleepLayout)}`);
  }
  await page.locator("#sleepCurtain").evaluate((element) => { element.hidden = true; });
  const brightPixelsBeforeGiant = await countSoftWhitePixels(page);

  await page.locator("#moonButton").tap();
  if (!(await page.locator("#moonButton").getAttribute("class")).includes("active")) {
    throw new Error("Moon mode did not activate");
  }

  await page.locator("#magicButton").tap();
  if (!(await page.locator("#toast").textContent())) throw new Error("Magic event did not run");
  await page.waitForTimeout(5000);
  const bubblePixelsNearTop = await countMagicPixels(page, [0, 0.38], "bubble");
  if (bubblePixelsNearTop < 40) throw new Error(`Bubbles did not reach the upper screen: ${bubblePixelsNearTop}`);

  await page.locator("#magicButton").tap();
  await page.waitForTimeout(90);
  const brightPixelsDuringPopup = await countSoftWhitePixels(page);
  await page.waitForTimeout(530);
  const brightPixelsAfterGiant = await countSoftWhitePixels(page);
  if (brightPixelsDuringPopup < brightPixelsBeforeGiant * 1.5
      || brightPixelsAfterGiant < brightPixelsBeforeGiant * 1.35) {
    throw new Error(`Giant popup did not expand enough: ${brightPixelsBeforeGiant} -> ${brightPixelsDuringPopup} -> ${brightPixelsAfterGiant}`);
  }

  await page.locator("#magicButton").tap();
  await page.waitForTimeout(4500);
  const starPixelsNearBottom = await countMagicPixels(page, [0.78, 1], "star");
  if (starPixelsNearBottom < 30) throw new Error(`Falling stars did not reach the bottom: ${starPixelsNearBottom}`);

  await triggerSyntheticShake(page);
  await page.waitForFunction(() => document.documentElement.classList.contains("ghosts-dizzy"));
  const dizzyToast = await page.locator("#toast").textContent();
  if (!dizzyToast.includes("转晕")) throw new Error(`Shake feedback missing: ${dizzyToast}`);
  await page.waitForTimeout(3100);
  if (await page.evaluate(() => document.documentElement.classList.contains("ghosts-dizzy"))) {
    throw new Error("Dizzy state lasted longer than expected");
  }

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
    sleepGhost,
    brightPixelsBeforeGiant,
    bubblePixelsNearTop,
    brightPixelsDuringPopup,
    brightPixelsAfterGiant,
    starPixelsNearBottom,
    dizzyToast,
    portraitControls,
    sleepLayout,
    landscapeCanvas,
    landscapeControls,
    serviceWorker: await page.evaluate(() => "serviceWorker" in navigator),
    status: "PASS",
  }, null, 2));
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  if (browser) await browser.close();
  process.exitCode = 1;
});
