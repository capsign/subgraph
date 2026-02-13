# Token Entity Strategy

## Overview

The subgraph uses a **hybrid interface + concrete entity approach** for handling different token types (EquityToken, SAFE, ESO, etc.).

## Architecture

### IToken Interface
Common fields shared by all token types:
- Basic metadata (name, symbol, decimals, totalSupply)
- Admin info (admin, creator, deployer, timestamps)
- State (paused, frozen accounts/lots)
- Relationships (lots, offerings)

### Concrete Entities

#### EquityToken
- **Purpose**: Traditional equity shares (Common, Preferred, etc.)
- **Facet**: TokenEquityTokenFacet
- **Specific Fields**:
  - `issuer`: The company issuing the shares
  - `agents`: Transfer agents
  - `maxSupply`: Maximum allowed shares (0 = unlimited)
  - OCF metadata (classType, votingRights, liquidationPreference, etc.)

#### Safe
- **Purpose**: Simple Agreement for Future Equity
- **Facet**: TokenSAFEFacet
- **Specific Fields**:
  - `issuer`: The company issuing the SAFE
  - `defaultValuationCap`: Valuation cap for conversions
  - `defaultDiscountRate`: Discount rate (basis points)
  - `defaultProRataRight`: Pro-rata participation rights
  - `defaultTargetEquityToken`: Which EquityToken this converts to
  - `defaultHasMFN`: Most Favored Nation clause
- **Relationships**:
  - `conversions`: Track when SAFEs convert to equity

#### EmployeeStockOption
- **Purpose**: Employee stock option grants
- **Facet**: TokenESOFacet
- **Specific Fields**:
  - `issuer`: The company issuing options
  - `underlyingEquityToken`: Which EquityToken these options exercise into
  - `defaultExercisePrice`: Strike price
  - `defaultExpirationPeriod`: How long after grant until expiry
  - `poolSize`: Total options in the pool
  - `optionsGranted`: Options already granted
  - `optionsExercised`: Options exercised
- **Relationships**:
  - `grants`: Individual grants to employees

#### Token (Generic)
- **Purpose**: Backwards compatibility or unknown token types
- **Fields**: Only the IToken interface fields
- **Use Case**: Fallback for tokens we don't recognize

## Event Handling Strategy

### Token Creation Flow

```
TokenFactory.TokenCreated event
    ↓
Determine token type by checking which facets are installed
    ↓
Create appropriate entity (EquityToken, Safe, ESO, or Token)
    ↓
Initialize with factory data
    ↓
Listen for type-specific initialization events
```

### Facet Detection

```typescript
function determineTokenType(tokenAddress: Address): string {
  // Query diamond to see which facets are installed
  const diamond = Diamond.load(tokenAddress.toHexString());
  
  // Check for type-specific facets
  if (hasTokenEquityTokenFacet(tokenAddress)) {
    return "EquityToken";
  } else if (hasTokenSAFEFacet(tokenAddress)) {
    return "Safe";
  } else if (hasTokenESOFacet(tokenAddress)) {
    return "EmployeeStockOption";
  }
  
  // Default to generic Token
  return "Token";
}
```

### Type-Specific Event Handlers

#### EquityToken Events (TokenEquityTokenFacet)
- `IssuerSet(address indexed issuer)`
- `AgentAdded(address indexed agent)`
- `AgentRemoved(address indexed agent)`
- `MaxSupplySet(uint256 maxSupply)`

#### SAFE Events (TokenSAFEFacet)
- `SAFETermsSet(uint256 valuationCap, uint256 discountRate, ...)`
- `SAFEConverted(bytes32 indexed lotId, address equityToken, uint256 shares)`

#### ESO Events (TokenESOFacet)
- `OptionGranted(address indexed grantee, bytes32 indexed lotId, uint256 quantity, ...)`
- `OptionExercised(address indexed holder, bytes32 indexed lotId, uint256 quantity)`
- `OptionRevoked(address indexed holder, bytes32 indexed lotId)`

#### Common Events (TokenAdminFacet - all types)
- `Paused(address account)`
- `Unpaused(address account)`
- `AccountFrozen(address indexed account)`
- `AccountUnfrozen(address indexed account)`
- `LotFrozen(bytes32 indexed lotId)`
- `LotUnfrozen(bytes32 indexed lotId)`

## Querying Strategy

### Query All Tokens (Unified)

```graphql
query GetAllTokens {
  equityTokens { ...ITokenFields }
  safes { ...ITokenFields }
  employeeStockOptions { ...ITokenFields }
  tokens { ...ITokenFields }
}
```

### Query Specific Type with Type-Specific Fields

```graphql
query GetEquityTokenes($issuer: Bytes!) {
  equityTokens(where: { issuer: $issuer }) {
    # IToken fields
    id
    name
    symbol
    totalSupply
    creator
    paused
    
    # EquityToken-specific
    issuer
    agents
    maxSupply
    classType
    votingRights
  }
}
```

### Query by Interface (if needed)

Note: GraphQL interfaces don't support direct queries, so we need to query each type separately and combine in the client.

## Migration Path

### Phase 1: Schema Update (Current)
- ✅ Define IToken interface
- ✅ Create EquityToken, Safe, ESO, Token entities
- ✅ Add type-specific relationship entities (SAFEConversion, ESOGrant, TransferCondition)

### Phase 2: Mapping Updates
1. Update `token-factory.ts` to determine token type and create appropriate entity
2. Create type-specific mapping files:
   - `share-class.ts`
   - `safe.ts`
   - `employee-stock-option.ts`
3. Update `tokens.ts` for common token events

### Phase 3: Interface Updates
1. Update GraphQL queries to use new entity types
2. Add type guards/discriminators in TypeScript
3. Update UI components to handle different token types

### Phase 4: Historical Data Migration (if needed)
- Script to migrate existing Token entities to appropriate types
- Based on assetType field or facet detection

## File Organization

```
subgraph/src/mappings/
├── token-factory.ts       # Token creation, type detection
├── tokens.ts              # Common token events (TokenInitialized)
├── token-admin.ts         # Admin events (pause, freeze)
├── share-class.ts         # EquityToken-specific events
├── safe.ts                # SAFE-specific events
├── eso.ts                 # ESO-specific events
└── transfer-conditions.ts # Vesting, lockups
```

## Benefits

1. **Type Safety**: Each token type has its own fields
2. **Extensibility**: Easy to add new token types
3. **Performance**: Query only what you need
4. **Clarity**: Clear separation of concerns
5. **Flexibility**: Can still query all tokens generically when needed

## Trade-offs

1. **Complexity**: More entities to manage
2. **Multiple Queries**: Need separate queries for unified "all tokens" view
3. **Migration**: Existing data needs migration

## Next Steps

1. Generate subgraph code: `pnpm run codegen`
2. Update mappings to create appropriate entity types
3. Test with token creation
4. Deploy to testnet




