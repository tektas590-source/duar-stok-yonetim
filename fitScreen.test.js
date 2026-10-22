import test from "node:test";
import assert from "node:assert/strict";
import { computeFitScale } from "./fitScreen.js";

test("büyük ekranda ölçek 1 kalır", () => assert.equal(computeFitScale(1920, 1080), 1));
test("kısa pencerede yüksekliğe göre küçülür", () => assert.equal(computeFitScale(1356, 574), 0.7));
test("dar masaüstünde genişliğe göre küçülür", () => assert.equal(computeFitScale(1100, 900), 0.76));
test("mobilde dokunulmaz", () => assert.equal(computeFitScale(420, 700), 1));
test("ölçek alt sınırın altına inmez", () => assert.equal(computeFitScale(950, 300), 0.7));
