import {
  parse,
  DocumentNode,
  OperationDefinitionNode,
  FragmentDefinitionNode,
  SelectionSetNode,
  FieldNode,
  Kind,
} from 'graphql';

export interface AstTreeNode {
  id: string;
  name: string;
  alias?: string;
  kind: 'Operation' | 'Field' | 'FragmentSpread' | 'InlineFragment';
  depth: number;
  baseCost: number;
  multiplier: number;
  computedCost: number;
  estimatedNPlusOneRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  arguments: { name: string; value: string }[];
  directives: string[];
  returnTypeHint: string;
  children: AstTreeNode[];
}

export interface QueryComplexityAnalysis {
  valid: boolean;
  error?: string;
  operationName: string;
  operationType: string;
  totalComplexityScore: number;
  maxAllowedComplexity: number;
  maxDepth: number;
  maxAllowedDepth: number;
  totalFields: number;
  listMultiplierPaths: string[];
  nPlusOneWarnings: {
    path: string;
    parentField: string;
    childField: string;
    estimatedDbCallsWithoutBatching: number;
    estimatedDbCallsWithDataLoader: number;
    recommendation: string;
  }[];
  astTree: AstTreeNode[];
  pipelineSteps: {
    step: string;
    status: 'PASS' | 'WARN' | 'BLOCK';
    durationUs: number;
    summary: string;
    details: string[];
  }[];
}

const LIST_FIELD_MULTIPLIERS: Record<string, number> = {
  orders: 8,
  recentOrders: 8,
  items: 4,
  lineItems: 4,
  reviews: 5,
  warehouses: 3,
  inventoryLogs: 6,
  paymentAttempts: 3,
  recommendations: 6,
  auditTrail: 10,
  subCategories: 4,
};

const RELATION_RESOLVER_FIELDS = new Set([
  'customer',
  'seller',
  'product',
  'shippingTrack',
  'warehouse',
  'author',
  'paymentLedger',
  'fraudAnalysis',
  'items',
  'reviews',
  'warehouses',
  'orders',
]);

const FIELD_TYPE_HINTS: Record<string, string> = {
  orders: '[Order!]!',
  items: '[OrderItem!]!',
  customer: 'Customer!',
  product: 'Product!',
  seller: 'Merchant!',
  reviews: '[Review!]!',
  shippingTrack: 'ShipmentTelemetry!',
  warehouse: 'WarehouseNode!',
  fraudAnalysis: 'FraudRiskScore!',
  paymentLedger: 'PaymentTransaction!',
  author: 'Customer!',
  recommendations: '[Product!]!',
};

export class AstComplexityAnalyzer {
  static analyze(
    querySource: string,
    maxAllowedComplexity = 250,
    maxAllowedDepth = 8,
  ): QueryComplexityAnalysis {
    const startHr = process.hrtime.bigint();
    let doc: DocumentNode;

    try {
      doc = parse(querySource, { noLocation: false });
    } catch (err: any) {
      return {
        valid: false,
        error: err?.message || 'Failed to parse GraphQL AST',
        operationName: 'InvalidQuery',
        operationType: 'query',
        totalComplexityScore: 0,
        maxAllowedComplexity,
        maxDepth: 0,
        maxAllowedDepth,
        totalFields: 0,
        listMultiplierPaths: [],
        nPlusOneWarnings: [],
        astTree: [],
        pipelineSteps: [
          {
            step: '1. Lexical & Syntactic AST Parse',
            status: 'BLOCK',
            durationUs: 120,
            summary: 'Syntax error encountered while building DocumentNode.',
            details: [err?.message || 'Syntax Error'],
          },
        ],
      };
    }

    const parseTimeUs = Number(process.hrtime.bigint() - startHr) / 1000;

    const fragments = new Map<string, FragmentDefinitionNode>();
    const operations: OperationDefinitionNode[] = [];

    for (const def of doc.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) {
        fragments.set(def.name.value, def);
      } else if (def.kind === Kind.OPERATION_DEFINITION) {
        operations.push(def);
      }
    }

    const primaryOp = operations[0];
    if (!primaryOp) {
      return {
        valid: false,
        error: 'No executable GraphQL operation definition found in document.',
        operationName: 'Empty',
        operationType: 'query',
        totalComplexityScore: 0,
        maxAllowedComplexity,
        maxDepth: 0,
        maxAllowedDepth,
        totalFields: 0,
        listMultiplierPaths: [],
        nPlusOneWarnings: [],
        astTree: [],
        pipelineSteps: [],
      };
    }

    let maxDepth = 0;
    let totalFields = 0;
    let totalComplexityScore = 0;
    const listMultiplierPaths: string[] = [];
    const nPlusOneWarnings: QueryComplexityAnalysis['nPlusOneWarnings'] = [];
    let nodeCounter = 0;

    const traverseSelectionSet = (
      selectionSet: SelectionSetNode | undefined,
      currentDepth: number,
      parentMultiplier: number,
      parentPath: string,
      parentFieldName: string,
      parentIsList: boolean,
    ): AstTreeNode[] => {
      if (!selectionSet) return [];
      const nodes: AstTreeNode[] = [];

      for (const selection of selectionSet.selections) {
        if (selection.kind === Kind.FIELD) {
          const fieldNode = selection as FieldNode;
          const fieldName = fieldNode.name.value;
          if (fieldName.startsWith('__')) continue;

          totalFields++;
          const depth = currentDepth + 1;
          if (depth > maxDepth) maxDepth = depth;

          const path = parentPath ? `${parentPath}.${fieldName}` : fieldName;

          // Extract arguments
          const args: { name: string; value: string }[] = [];
          let explicitLimit: number | undefined;

          for (const arg of fieldNode.arguments || []) {
            let valStr = '';
            if (arg.value.kind === Kind.INT) {
              valStr = arg.value.value;
              if (
                arg.name.value === 'limit' ||
                arg.name.value === 'first' ||
                arg.name.value === 'take' ||
                arg.name.value === 'count'
              ) {
                explicitLimit = Math.max(1, parseInt(valStr, 10));
              }
            } else if (arg.value.kind === Kind.STRING) {
              valStr = `"${arg.value.value}"`;
            } else if (arg.value.kind === Kind.BOOLEAN) {
              valStr = String(arg.value.value);
            } else if (arg.value.kind === Kind.ENUM) {
              valStr = arg.value.value;
            } else if (arg.value.kind === Kind.VARIABLE) {
              valStr = `$${arg.value.name.value}`;
            } else {
              valStr = '[InputObject]';
            }
            args.push({ name: arg.name.value, value: valStr });
          }

          const isListField = fieldName in LIST_FIELD_MULTIPLIERS;
          const localMultiplier =
            explicitLimit ??
            (isListField ? LIST_FIELD_MULTIPLIERS[fieldName] : 1);
          const effectiveMultiplier = parentMultiplier * localMultiplier;

          if (isListField || explicitLimit) {
            listMultiplierPaths.push(`${path} (×${localMultiplier})`);
          }

          const hasSubfields = Boolean(
            fieldNode.selectionSet &&
              fieldNode.selectionSet.selections.length > 0,
          );
          const isRelationResolver = RELATION_RESOLVER_FIELDS.has(fieldName);
          const baseCost = isRelationResolver ? 3 : hasSubfields ? 2 : 1;
          const computedCost = baseCost * parentMultiplier;
          totalComplexityScore += computedCost;

          // Detect N+1 bottleneck when a relation resolver executes inside a list parent
          let risk: AstTreeNode['estimatedNPlusOneRisk'] = 'LOW';
          if (parentIsList && isRelationResolver) {
            risk =
              parentMultiplier >= 20
                ? 'CRITICAL'
                : parentMultiplier >= 6
                  ? 'HIGH'
                  : 'MEDIUM';
            nPlusOneWarnings.push({
              path,
              parentField: parentFieldName,
              childField: fieldName,
              estimatedDbCallsWithoutBatching: parentMultiplier,
              estimatedDbCallsWithDataLoader: 1,
              recommendation: `Wrap "${fieldName}" resolver in request-scoped DataLoader<string, ${
                FIELD_TYPE_HINTS[fieldName]?.replace(/[\[\]!]/g, '') || 'Entity'
              }> to collapse ${parentMultiplier} SQL/RPC roundtrips into 1 batched lookup.`,
            });
          } else if (isRelationResolver && depth >= 3) {
            risk = 'MEDIUM';
          }

          const children = traverseSelectionSet(
            fieldNode.selectionSet,
            depth,
            effectiveMultiplier,
            path,
            fieldName,
            isListField || parentIsList,
          );

          nodes.push({
            id: `ast-node-${++nodeCounter}`,
            name: fieldName,
            alias: fieldNode.alias?.value,
            kind: 'Field',
            depth,
            baseCost,
            multiplier: parentMultiplier,
            computedCost,
            estimatedNPlusOneRisk: risk,
            arguments: args,
            directives: (fieldNode.directives || []).map(
              (d) => `@${d.name.value}`,
            ),
            returnTypeHint:
              FIELD_TYPE_HINTS[fieldName] ||
              (hasSubfields ? 'Object' : 'Scalar'),
            children,
          });
        } else if (selection.kind === Kind.FRAGMENT_SPREAD) {
          const fragName = selection.name.value;
          const fragDef = fragments.get(fragName);
          if (fragDef) {
            const fragChildren = traverseSelectionSet(
              fragDef.selectionSet,
              currentDepth + 1,
              parentMultiplier,
              `${parentPath}...${fragName}`,
              parentFieldName,
              parentIsList,
            );
            nodes.push({
              id: `ast-node-${++nodeCounter}`,
              name: `...${fragName} (on ${fragDef.typeCondition.name.value})`,
              kind: 'FragmentSpread',
              depth: currentDepth + 1,
              baseCost: 1,
              multiplier: parentMultiplier,
              computedCost: parentMultiplier,
              estimatedNPlusOneRisk: 'LOW',
              arguments: [],
              directives: [],
              returnTypeHint: fragDef.typeCondition.name.value,
              children: fragChildren,
            });
          }
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          const typeCond = selection.typeCondition?.name.value || 'Inline';
          const inlineChildren = traverseSelectionSet(
            selection.selectionSet,
            currentDepth + 1,
            parentMultiplier,
            `${parentPath}...on_${typeCond}`,
            parentFieldName,
            parentIsList,
          );
          nodes.push({
            id: `ast-node-${++nodeCounter}`,
            name: `... on ${typeCond}`,
            kind: 'InlineFragment',
            depth: currentDepth + 1,
            baseCost: 1,
            multiplier: parentMultiplier,
            computedCost: parentMultiplier,
            estimatedNPlusOneRisk: 'LOW',
            arguments: [],
            directives: [],
            returnTypeHint: typeCond,
            children: inlineChildren,
          });
        }
      }

      return nodes;
    };

    const opName = primaryOp.name?.value || 'AnonymousOperation';
    const rootChildren = traverseSelectionSet(
      primaryOp.selectionSet,
      0,
      1,
      opName,
      opName,
      false,
    );

    const rootNode: AstTreeNode = {
      id: 'ast-root-0',
      name: `${primaryOp.operation} ${opName}`,
      kind: 'Operation',
      depth: 0,
      baseCost: 1,
      multiplier: 1,
      computedCost: totalComplexityScore,
      estimatedNPlusOneRisk:
        nPlusOneWarnings.length > 2
          ? 'CRITICAL'
          : nPlusOneWarnings.length > 0
            ? 'HIGH'
            : 'LOW',
      arguments: (primaryOp.variableDefinitions || []).map((v) => ({
        name: `$${v.variable.name.value}`,
        value: 'Variable',
      })),
      directives: (primaryOp.directives || []).map((d) => `@${d.name.value}`),
      returnTypeHint: 'QueryRoot',
      children: rootChildren,
    };

    const totalWalkUs = Number(process.hrtime.bigint() - startHr) / 1000;

    const depthStatus =
      maxDepth > maxAllowedDepth
        ? 'BLOCK'
        : maxDepth >= maxAllowedDepth - 1
          ? 'WARN'
          : 'PASS';
    const complexityStatus =
      totalComplexityScore > maxAllowedComplexity
        ? 'BLOCK'
        : totalComplexityScore > maxAllowedComplexity * 0.75
          ? 'WARN'
          : 'PASS';
    const nPlusOneStatus =
      nPlusOneWarnings.length >= 3
        ? 'WARN'
        : nPlusOneWarnings.length > 0
          ? 'WARN'
          : 'PASS';

    const pipelineSteps: QueryComplexityAnalysis['pipelineSteps'] = [
      {
        step: '1. Lexical & Syntactic AST Parse',
        status: 'PASS',
        durationUs: Math.round(parseTimeUs),
        summary: `Parsed ${totalFields} AST field nodes across ${operations.length} operation(s) and ${fragments.size} fragment(s).`,
        details: [
          `Operation: ${primaryOp.operation.toUpperCase()} "${opName}"`,
          `Total AST Field Selection Nodes: ${totalFields}`,
          `Fragments Resolved: ${fragments.size}`,
        ],
      },
      {
        step: '2. Query Depth Gatekeeper',
        status: depthStatus,
        durationUs: Math.round(totalWalkUs * 0.35),
        summary: `Measured AST nesting depth ${maxDepth} against threshold ${maxAllowedDepth}.`,
        details: [
          `Max Nesting Depth: ${maxDepth} levels`,
          `Configured Max Allowed Depth: ${maxAllowedDepth} levels`,
          depthStatus === 'BLOCK'
            ? `REJECTED: Query exceeds maximum allowed depth (${maxDepth} > ${maxAllowedDepth}).`
            : `PASSED: Nesting depth within safe bounds.`,
        ],
      },
      {
        step: '3. Cost & List Multiplier Static Analysis',
        status: complexityStatus,
        durationUs: Math.round(totalWalkUs * 0.45),
        summary: `Calculated static query cost ${totalComplexityScore} pts (budget: ${maxAllowedComplexity} pts).`,
        details: [
          `Total Weighted Cost Score: ${totalComplexityScore} pts`,
          `Active List Multipliers: ${listMultiplierPaths.join(', ') || 'None (1x)'}`,
          complexityStatus === 'BLOCK'
            ? `THROTTLED: Query cost ${totalComplexityScore} exceeds budget ${maxAllowedComplexity}.`
            : `PASSED: Cost within rate-limiter token budget.`,
        ],
      },
      {
        step: '4. N+1 Resolver Fan-out Predictor',
        status: nPlusOneStatus,
        durationUs: Math.round(totalWalkUs * 0.2),
        summary:
          nPlusOneWarnings.length > 0
            ? `Detected ${nPlusOneWarnings.length} potential N+1 resolver fan-out hotspots.`
            : 'Zero unbatched list-child relation fan-out risks detected.',
        details:
          nPlusOneWarnings.length > 0
            ? nPlusOneWarnings.map(
                (w) =>
                  `${w.path}: ${w.estimatedDbCallsWithoutBatching} unbatched DB hits -> ${w.estimatedDbCallsWithDataLoader} batched via DataLoader`,
              )
            : ['All child resolvers are scalar or root-scoped.'],
      },
    ];

    return {
      valid: true,
      operationName: opName,
      operationType: primaryOp.operation,
      totalComplexityScore,
      maxAllowedComplexity,
      maxDepth,
      maxAllowedDepth,
      totalFields,
      listMultiplierPaths,
      nPlusOneWarnings,
      astTree: [rootNode],
      pipelineSteps,
    };
  }
}
