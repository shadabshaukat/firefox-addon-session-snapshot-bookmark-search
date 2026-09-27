const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const core = require("../src/core.js");

const popupSource = fs.readFileSync(path.join(__dirname, "..", "src", "popup.js"), "utf8");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.className = "";
    this.children = [];
    this.dataset = {};
    this.files = [];
    this.hidden = false;
    this.tabIndex = 0;
    this.value = "";
    this._textContent = "";
    this.attributes = {};
    this.classList = {
      toggle() {}
    };
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
    if (value === "") this.children = [];
  }

  addEventListener() {}

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  append(...children) {
    this.children.push(...children);
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  querySelectorAll() {
    return [];
  }
}

function createFakeDocument() {
  const elements = new Map();
  const tabs = ["sessions", "import", "search", "recovery"].map((panel) => {
    const tab = new FakeElement(`tab-${panel}`);
    tab.dataset.panel = panel;
    return tab;
  });

  return {
    readyState: "complete",
    elements,
    addEventListener() {},
    createElement() {
      return new FakeElement();
    },
    createTextNode(text) {
      const node = new FakeElement();
      node.textContent = text;
      return node;
    },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll(selector) {
      if (selector === ".tab-button") return tabs;
      return [];
    }
  };
}

async function runPopup({ failStorage = false } = {}) {
  const document = createFakeDocument();
  const loggedErrors = [];
  const browser = {
    storage: {
      local: {
        async get(defaults) {
          if (failStorage) throw new Error("Storage unavailable");
          return defaults;
        },
        async set() {}
      }
    }
  };
  const context = {
    SessionSnapCore: core,
    browser,
    document,
    console: {
      ...console,
      error(...args) {
        loggedErrors.push(args);
      }
    },
    setTimeout,
    clearTimeout,
    window: {
      setTimeout,
      clearTimeout
    }
  };

  vm.runInNewContext(popupSource, context, { filename: "popup.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return { document, loggedErrors };
}

async function testSuccessfulFirstOpen() {
  const { document, loggedErrors } = await runPopup();
  assert.strictEqual(document.getElementById("snapshotCounter").textContent, "0 snapshots");
  assert.strictEqual(document.getElementById("status").className, "success");
  assert.match(document.getElementById("status").textContent, /Ready/);
  assert.strictEqual(document.getElementById("snapshotList").children.length, 1);
  assert.strictEqual(loggedErrors.length, 0);
}

async function testStorageFailureStillOpens() {
  const { document, loggedErrors } = await runPopup({ failStorage: true });
  assert.strictEqual(document.getElementById("snapshotCounter").textContent, "0 snapshots");
  assert.strictEqual(document.getElementById("status").className, "warning");
  assert.match(document.getElementById("status").textContent, /safe defaults/);
  assert.strictEqual(document.getElementById("snapshotList").children.length, 1);
  assert.strictEqual(loggedErrors.length, 2);
}

(async () => {
  await testSuccessfulFirstOpen();
  await testStorageFailureStillOpens();
  console.log("All popup startup tests passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
