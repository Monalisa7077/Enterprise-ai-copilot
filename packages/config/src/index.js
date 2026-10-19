"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCorsOrigins = parseCorsOrigins;
function parseCorsOrigins(raw) {
    return raw
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}
