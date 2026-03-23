#!/bin/bash

echo "=========================================="
echo "Testing Catalog API"
echo "=========================================="
echo ""

echo "1. Health Check:"
curl -s http://localhost:3002/health | jq .
echo ""
echo ""

echo "2. Catalog Stats:"
curl -s http://localhost:3002/api/catalog/stats | jq .
echo ""
echo ""

echo "3. Search: 'AllyAI training'"
curl -s -X POST http://localhost:3002/api/catalog/search \
  -H "Content-Type: application/json" \
  -d '{"query": "AllyAI training", "topK": 3}' | jq .
echo ""
echo ""

echo "4. Search: 'Copilot Amazon'"
curl -s -X POST http://localhost:3002/api/catalog/search \
  -H "Content-Type: application/json" \
  -d '{"query": "Copilot Amazon", "topK": 3}' | jq .
echo ""
echo ""

echo "5. Search: 'product success'"
curl -s -X POST http://localhost:3002/api/catalog/search \
  -H "Content-Type: application/json" \
  -d '{"query": "product success", "topK": 3}' | jq .
echo ""
