#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, dirname, resolve } from "path";

const repoDir = resolve(import.meta.dir, "..");
const referencePath = resolve(repoDir, "config.example.json");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function valueType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function collectSchema(value, prefix = "") {
  const schema = new Map();
  const type = valueType(value);
  if (prefix) schema.set(prefix, type);

  if (type !== "object") return schema;
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    for (const [path, childType] of collectSchema(child, childPath)) {
      schema.set(path, childType);
    }
  }
  return schema;
}

function discoverConfigPaths(argv) {
  if (argv.length > 0) {
    return argv.map((arg) => resolve(repoDir, arg));
  }

  const candidates = ["config.example.json"];
  for (const name of readdirSync(repoDir)) {
    if (/^config(?:-[A-Za-z0-9._-]+)?\.json$/.test(name)) {
      candidates.push(name);
    }
  }
  return [...new Set(candidates)].map((name) => resolve(repoDir, name));
}

function compareSchema(filePath, referenceSchema) {
  const schema = collectSchema(readJson(filePath));
  const errors = [];

  for (const [path, expectedType] of referenceSchema) {
    if (!schema.has(path)) {
      errors.push(`${path}: missing`);
      continue;
    }
    const actualType = schema.get(path);
    if (actualType !== expectedType) {
      errors.push(`${path}: expected ${expectedType}, got ${actualType}`);
    }
  }

  for (const path of schema.keys()) {
    if (!referenceSchema.has(path)) {
      errors.push(`${path}: extra key`);
    }
  }

  return errors;
}

function normalizeDiscussChatIds(config) {
  const ids = config?.shared?.discussChatIds;
  if (!Array.isArray(ids)) return [];
  return ids
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
}

function sharedContextStoreKey(config, filePath) {
  const shared = config?.shared || {};
  const backend = shared.sharedContextBackend || "sqlite";
  if (backend === "redis") {
    return {
      key: `redis:${shared.redisUrl || "redis://localhost:6379"}`,
      field: "shared.redisUrl",
    };
  }
  if (backend === "json") {
    return {
      key: `json:${resolve(dirname(filePath), shared.sharedContextJsonPath || "shared-context.json")}`,
      field: "shared.sharedContextJsonPath",
    };
  }
  return {
    key: `sqlite:${resolve(dirname(filePath), shared.sharedContextDb || "shared-context.db")}`,
    field: "shared.sharedContextDb",
  };
}

function compareSharedContextStores(configEntries) {
  const errorsByPath = new Map(configEntries.map(({ filePath }) => [filePath, []]));
  const firstByChatId = new Map();

  for (const { filePath, config } of configEntries) {
    if (config?.shared?.enableGroupSharedContext === false) continue;
    const discussChatIds = normalizeDiscussChatIds(config);
    if (discussChatIds.length === 0) continue;

    const store = sharedContextStoreKey(config, filePath);
    for (const chatId of discussChatIds) {
      const first = firstByChatId.get(chatId);
      if (!first) {
        firstByChatId.set(chatId, { filePath, store });
        continue;
      }
      if (first.store.key === store.key) continue;

      errorsByPath.get(filePath).push(
        `${store.field}: discuss chat ${chatId} also appears in ${basename(first.filePath)} but uses a different shared context store`
      );
      errorsByPath.get(first.filePath).push(
        `${first.store.field}: discuss chat ${chatId} also appears in ${basename(filePath)} but uses a different shared context store`
      );
    }
  }

  return errorsByPath;
}

function main() {
  if (!existsSync(referencePath)) {
    throw new Error(`Missing reference schema: ${referencePath}`);
  }
  const referenceSchema = collectSchema(readJson(referencePath));
  const configPaths = discoverConfigPaths(process.argv.slice(2));
  const configEntries = [];
  const semanticErrorsByPath = new Map();
  let failed = false;

  for (const filePath of configPaths) {
    if (!existsSync(filePath)) {
      console.error(`[check-configs] ${basename(filePath)} missing`);
      failed = true;
      continue;
    }
    configEntries.push({ filePath, config: readJson(filePath) });
  }

  for (const [filePath, errors] of compareSharedContextStores(configEntries)) {
    semanticErrorsByPath.set(filePath, errors);
  }

  for (const { filePath } of configEntries) {
    const errors = compareSchema(filePath, referenceSchema);
    errors.push(...(semanticErrorsByPath.get(filePath) || []));
    if (errors.length > 0) {
      failed = true;
      console.error(`[check-configs] ${basename(filePath)} failed`);
      for (const error of errors) {
        console.error(`  - ${error}`);
      }
      continue;
    }
    console.log(`[check-configs] ${basename(filePath)} ok`);
  }

  if (failed) process.exit(1);
}

main();
