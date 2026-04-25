#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "fs";
import { basename, resolve } from "path";

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

function main() {
  if (!existsSync(referencePath)) {
    throw new Error(`Missing reference schema: ${referencePath}`);
  }
  const referenceSchema = collectSchema(readJson(referencePath));
  const configPaths = discoverConfigPaths(process.argv.slice(2));
  let failed = false;

  for (const filePath of configPaths) {
    if (!existsSync(filePath)) {
      console.error(`[check-configs] ${basename(filePath)} missing`);
      failed = true;
      continue;
    }
    const errors = compareSchema(filePath, referenceSchema);
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
