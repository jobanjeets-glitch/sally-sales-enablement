#!/usr/bin/env node

function normalizeName(fileName) {
    return fileName
        .replace(/\.(pdf|pptx?|docx?|xlsx?|gslides?|gdocs?|gsheet?)$/i, '')
        .replace(/[_\-:]+/g, ' ')
        .replace(/\(copy\s*\d*\)/gi, '')
        // Strip version indicators (va, vb, v1, v2, v1.1, etc.)
        .replace(/\s+v[a-z]\b/gi, '')  // va, vb, vc
        .replace(/\s+v\d+(\.\d+)*/gi, '')  // v1, v2, v1.1
        .replace(/\s+_v\d+(\.\d+)*/gi, '')  // _v1
        .replace(/\s+version\s+\d+/gi, '')
        // Normalize common document aliases
        .replace(/\bquarterly\s+industry\s+trends\b/gi, 'state of retail ecommerce')
        .replace(/\bthe\s+state\s+of\s+retail\s+ecommerce\b/gi, 'state of retail ecommerce')
        .replace(/\bindustry\s*trends\b/gi, 'state of retail ecommerce')
        // Normalize common abbreviations
        .replace(/\bgen\s+ai\b/gi, 'generative ai')
        .replace(/\bai\s+goal\s+optimizer\b/gi, 'aigo')
        // Remove year duplicates (e.g., "2025 Q3 report sept 2025" -> "Q3 report sept")
        .replace(/\b(202[0-9])\b.*\b\1\b/gi, (match, year) => match.replace(new RegExp(`\\b${year}\\b`, 'gi'), '').replace(/\s+/g, ' '))
        .toLowerCase()
        .replace(/\s+/g, ' ')  // Collapse multiple spaces
        .trim();
}

const driveName = "CommerceIQ-Quarterly-Industry-Trends-2025-Q3-report-Sept-2025-va";
const pineconeName = "CommerceIQ-The-State-of-retail-Ecommerce-Q3-2025-report-Sept-va.pdf";

console.log("Drive file:");
console.log("  Original:", driveName);
console.log("  Normalized:", normalizeName(driveName));
console.log();

console.log("Pinecone file:");
console.log("  Original:", pineconeName);
console.log("  Normalized:", normalizeName(pineconeName));
console.log();

const n1 = normalizeName(driveName);
const n2 = normalizeName(pineconeName);

console.log("Exact match:", n1 === n2);
console.log("n1.length:", n1.length, "n2.length:", n2.length);
console.log("n1 includes n2:", n1.includes(n2));
console.log("n2 includes n1:", n2.includes(n1));
