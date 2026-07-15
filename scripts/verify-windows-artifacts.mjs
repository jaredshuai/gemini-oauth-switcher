import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = parseArgs(process.argv.slice(2));
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = packageJson.version;
const releaseDir = path.resolve(args.releaseDir ?? fileURLToPath(new URL("../release", import.meta.url)));
const minimumExeBytes = args.minimumExeBytes ?? 10 * 1024 * 1024;
const installerName = `Gemini-OAuth-Switcher-${version}-setup-x64.exe`;
const portableName = `Gemini-OAuth-Switcher-${version}-portable-x64.exe`;
const blockmapName = `${installerName}.blockmap`;
const latestName = "latest.yml";

try {
  const installer = await verifyExecutable(path.join(releaseDir, installerName), minimumExeBytes);
  const portable = await verifyExecutable(path.join(releaseDir, portableName), minimumExeBytes);
  const blockmap = await verifyNonEmptyFile(path.join(releaseDir, blockmapName));
  const latestPath = path.join(releaseDir, latestName);
  const latest = await verifyNonEmptyFile(latestPath);
  const latestContents = await readFile(latestPath, "utf8");

  verifyLatestMetadata(latestContents, {
    version,
    installerName,
    installerSize: installer.size
  });

  const artifacts = [
    [installerName, installer],
    [portableName, portable],
    [blockmapName, blockmap],
    [latestName, latest]
  ];
  console.log(`Verified Windows artifacts for ${version}:`);
  for (const [name, details] of artifacts) {
    console.log(`- ${name} (${details.size} bytes, sha256 ${details.sha256.slice(0, 12)})`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--release-dir") {
      parsed.releaseDir = requireValue(values, ++index, value);
    } else if (value === "--minimum-exe-bytes") {
      const minimum = Number(requireValue(values, ++index, value));
      if (!Number.isSafeInteger(minimum) || minimum < 2) {
        throw new Error("--minimum-exe-bytes must be an integer greater than or equal to 2.");
      }
      parsed.minimumExeBytes = minimum;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return parsed;
}

function requireValue(values, index, argument) {
  const value = values[index];
  if (!value) {
    throw new Error(`Missing value for ${argument}.`);
  }
  return value;
}

async function verifyExecutable(filePath, minimumBytes) {
  const details = await verifyNonEmptyFile(filePath);
  if (details.size < minimumBytes) {
    throw new Error(`${path.basename(filePath)} is unexpectedly small: ${details.size} bytes.`);
  }

  const handle = await open(filePath, "r");
  try {
    const header = Buffer.alloc(2);
    await handle.read(header, 0, header.length, 0);
    if (header[0] !== 0x4d || header[1] !== 0x5a) {
      throw new Error(`${path.basename(filePath)} is not a Windows PE executable.`);
    }
  } finally {
    await handle.close();
  }

  return details;
}

async function verifyNonEmptyFile(filePath) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    throw new Error(`Missing release artifact: ${path.basename(filePath)}`);
  }
  if (!fileStat.isFile() || fileStat.size <= 0) {
    throw new Error(`Release artifact is empty or not a file: ${path.basename(filePath)}`);
  }

  const contents = await readFile(filePath);
  return {
    size: fileStat.size,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

function verifyLatestMetadata(contents, expected) {
  assertYamlScalar(contents, "version", expected.version);
  assertYamlScalar(contents, "path", expected.installerName);

  const urlPattern = new RegExp(`^\\s*-\\s+url:\\s*${escapeRegExp(expected.installerName)}\\s*$`, "m");
  if (!urlPattern.test(contents)) {
    throw new Error(`latest.yml does not reference ${expected.installerName} in files[].url.`);
  }

  const sizePattern = new RegExp(`^\\s+size:\\s*${expected.installerSize}\\s*$`, "m");
  if (!sizePattern.test(contents)) {
    throw new Error(`latest.yml installer size does not match ${expected.installerSize} bytes.`);
  }

  const sha512Values = [...contents.matchAll(/^\s*sha512:\s*([a-zA-Z0-9+/=]+)\s*$/gm)].map((match) => match[1]);
  if (sha512Values.length < 2 || sha512Values.some((value) => value.length < 80) || new Set(sha512Values).size !== 1) {
    throw new Error("latest.yml must contain matching file and top-level sha512 values.");
  }
}

function assertYamlScalar(contents, key, expectedValue) {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*['\"]?${escapeRegExp(expectedValue)}['\"]?\\s*$`, "m");
  if (!pattern.test(contents)) {
    throw new Error(`latest.yml ${key} does not match ${expectedValue}.`);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
