import { AstComplexityAnalyzer } from './ast-complexity.analyzer';

describe('AstComplexityAnalyzer', () => {
  it('computes depth, complexity score, and N+1 warnings for deeply nested queries', () => {
    const query = `
      query InspectOrders($limit: Int = 6) {
        orders(limit: $limit) {
          id
          orderNumber
          totalUsd
          customer {
            id
            name
            vipTier
          }
          items {
            id
            quantity
            product {
              id
              sku
              name
              seller {
                id
                name
                slaUptimePct
              }
              reviews {
                id
                rating
                comment
              }
            }
          }
        }
      }
    `;

    const analysis = AstComplexityAnalyzer.analyze(query, 250, 8);

    expect(analysis.valid).toBe(true);
    expect(analysis.operationName).toBe('InspectOrders');
    expect(analysis.maxDepth).toBe(5);
    expect(analysis.totalComplexityScore).toBeGreaterThan(100);
    expect(analysis.nPlusOneWarnings.length).toBeGreaterThanOrEqual(4);
    expect(analysis.astTree.length).toBe(1);
    expect(analysis.astTree[0].children.length).toBe(1);
    expect(analysis.pipelineSteps.length).toBe(4);
  });

  it('flags queries that exceed maxAllowedDepth or maxAllowedComplexity', () => {
    const deepQuery = `
      query TooDeep {
        orders(limit: 10) {
          items {
            product {
              warehouses {
                id
                city
              }
            }
          }
        }
      }
    `;

    const analysis = AstComplexityAnalyzer.analyze(deepQuery, 50, 3);
    expect(analysis.valid).toBe(true);
    expect(analysis.maxDepth).toBe(5);
    const depthStep = analysis.pipelineSteps.find((s) =>
      s.step.includes('Depth'),
    );
    expect(depthStep?.status).toBe('BLOCK');
  });

  it('gracefully handles syntax errors in GraphQL documents', () => {
    const invalidQuery = `query Broken { orders { id `;
    const analysis = AstComplexityAnalyzer.analyze(invalidQuery);
    expect(analysis.valid).toBe(false);
    expect(analysis.error).toBeDefined();
    expect(analysis.pipelineSteps[0].status).toBe('BLOCK');
  });
});
