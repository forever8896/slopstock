# 02 — Smart Contracts

## 1. Contract inventory

| Contract | Chain | LoC est | Built from scratch? |
|---|---|---|---|
| `AgentNFT` (ERC-7857) | 0G Chain | use ref impl | **No** — fork `github.com/0gfoundation/0g-agent-nft` |
| `ShareToken` | 0G Chain | ~80 | OpenZeppelin ERC20 + minor |
| `Fractionalizer` | 0G Chain | ~150 | Yes |
| `IPOSale` | Base | ~120 | Yes |
| `RevenueVault` | Base | ~200 | Yes (snapshot pattern) |
| `Marketplace` | 0G Chain | ~250 | Yes |
| `AgentRegistry` | 0G Chain | ~80 | Yes |
| `StratumResolver` (ENS resolver) | Sepolia | ~150 | CCIP-Read pattern, see ENS doc |

**Total custom Solidity:** ~1,200 LoC. Achievable in 36h by 1 contracts dev + Foundry.

## 2. Common conventions

- Solidity `^0.8.24`
- Foundry as build/test/deploy
- All contracts non-upgradeable for v1 (we say "v1 is immutable; v2 will use UUPS" — judges respect this)
- All revenue-affecting state changes emit events (see Events section per contract)
- USDC = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base; on 0G Chain we use the canonical bridged USDC if present, else a mock
- All transfers use `SafeERC20`
- All time-sensitive logic uses `block.timestamp` (we accept ±15s drift — see threat model)

## 3. `AgentNFT` (ERC-7857)

We **do not reimplement** the standard. We fork the reference at `github.com/0gfoundation/0g-agent-nft` and parameterize it.

### 3.1 Key external functions we rely on

```solidity
function mint(
    address to,
    bytes32 metadataHash,
    string  calldata metadataURI,
    bytes   calldata sealedKey,        // sealed under `to`'s pubkey
    bytes   calldata teeAttestation    // proves sealed weights match metadataHash
) external returns (uint256 tokenId);

function iTransfer(
    uint256 tokenId,
    address to,
    bytes   calldata transferValidityProof  // re-encryption proof from TEE/ZKP oracle
) external;

function authorizeUsage(
    uint256 tokenId,
    address user,
    uint64  expiresAt
) external;     // only owner; max 100 active grants per token

function revokeUsage(uint256 tokenId, address user) external;

function isAuthorized(uint256 tokenId, address user) external view returns (bool);

function iClone(
    uint256 tokenId,
    bytes calldata transferValidityProof  // proves clone is valid encrypted copy
) external returns (uint256 newTokenId);
```

### 3.2 Events we hook into

- `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)` — flips ENS resolver
- `UsageAuthorized(uint256 indexed tokenId, address indexed user, uint64 expiresAt)`
- `UsageRevoked(uint256 indexed tokenId, address indexed user)`
- `MetadataUpdated(uint256 indexed tokenId, string newURI)`

### 3.3 What we extend (subclass `StratumAgentNFT extends AgentNFT`)

- `mapping(uint256 => address) public revenueVault;` — set at mint
- `mapping(uint256 => address) public shareToken;` — set when fractionalized
- `mapping(uint256 => string) public ensName;` — set at mint
- override `_afterTransfer` hook to clear `authorizeUsage[]` for that tokenId (already done by 7857 spec, but we double-check)

### 3.4 Acceptance tests

- Mint with valid attestation succeeds; with invalid reverts.
- `iTransfer` requires a `transferValidityProof`; without it reverts. Mock TEE oracle in tests.
- After `iTransfer`, all previous `authorizeUsage` grants return `false`.
- `iClone` produces a new tokenId with same metadataHash but different sealedKey.

## 4. `ShareToken`

Standard ERC-20 with two extras: snapshots and frozen-supply.

```solidity
contract ShareToken is ERC20, ERC20Snapshot, Ownable {
    uint256 public constant TOTAL_SUPPLY = 1_000_000 * 10**18;

    address public agentNft;
    uint256 public agentTokenId;

    constructor(
        address _agentNft,
        uint256 _agentTokenId,
        string memory name_,
        string memory symbol_,
        address recipient
    ) ERC20(name_, symbol_) {
        agentNft = _agentNft;
        agentTokenId = _agentTokenId;
        _mint(recipient, TOTAL_SUPPLY);   // recipient = Fractionalizer
    }

    /// Called only by RevenueVault to snapshot holders before distribution.
    function snapshot() external onlyOwner returns (uint256) {
        return _snapshot();
    }
}
```

- Total supply: **1,000,000 shares** (× 10^18 for ERC-20 decimals).
- Owner = `RevenueVault` (so only the vault can call `snapshot()`).
- `snapshot()` produces a checkpoint id; `balanceOfAt(addr, snapshotId)` returns historical balance.

## 5. `Fractionalizer`

Locks the iNFT, mints shares.

```solidity
contract Fractionalizer is IERC721Receiver {
    AgentNFT public immutable agentNft;

    struct Vault {
        address shareToken;
        address creator;
        bool    active;
    }
    mapping(uint256 => Vault) public vaults;  // tokenId → Vault

    event Fractionalized(uint256 indexed tokenId, address shareToken, address creator);
    event Redeemed(uint256 indexed tokenId, address by);

    /// Caller must own the iNFT and have approved this contract.
    function fractionalize(
        uint256 tokenId,
        string memory shareName,
        string memory shareSymbol,
        address shareRecipient            // typically operator's treasury
    ) external returns (address shareToken) {
        require(!vaults[tokenId].active, "already fractionalized");
        agentNft.transferFrom(msg.sender, address(this), tokenId);
        shareToken = address(new ShareToken(
            address(agentNft), tokenId, shareName, shareSymbol, shareRecipient
        ));
        vaults[tokenId] = Vault(shareToken, msg.sender, true);
        emit Fractionalized(tokenId, shareToken, msg.sender);
    }

    /// Redeem requires holding 100% of shares.
    function redeem(uint256 tokenId) external {
        Vault memory v = vaults[tokenId];
        require(v.active, "not fractionalized");
        ShareToken s = ShareToken(v.shareToken);
        require(s.balanceOf(msg.sender) == s.totalSupply(), "not 100% holder");
        s.burnFrom(msg.sender, s.totalSupply());      // requires shares burnable; or transferFrom to 0x0
        agentNft.transferFrom(address(this), msg.sender, tokenId);
        vaults[tokenId].active = false;
        emit Redeemed(tokenId, msg.sender);
    }

    function onERC721Received(address, address, uint256, bytes calldata)
        external pure returns (bytes4)
    {
        return IERC721Receiver.onERC721Received.selector;
    }
}
```

**Edge cases:**
- If iNFT is `iTransfer`'d while locked, `Fractionalizer` is the new owner. Only `redeem()` can pull it out.
- Acquisition flow (whole-agent buyout) requires the acquirer to first acquire **all 1M shares**, then call `redeem()`, then optionally re-fractionalize. Or: a special `Marketplace` flow — see §8.

## 6. `IPOSale`

Fixed-price sale of seed allocation (skip AMM in v1).

```solidity
contract IPOSale {
    ERC20  public immutable shareToken;
    ERC20  public immutable paymentAsset;       // USDC on Base
    uint256 public immutable pricePerShare;     // wei of paymentAsset per 1 share (atomic units)
    uint256 public immutable maxShares;         // cap of this round
    address public immutable beneficiary;       // operator's treasury
    uint64  public immutable startsAt;
    uint64  public immutable endsAt;

    uint256 public sold;

    event Bought(address indexed buyer, uint256 amount, uint256 cost);

    function buy(uint256 amount) external {
        require(block.timestamp >= startsAt && block.timestamp < endsAt, "closed");
        require(sold + amount <= maxShares, "sold out");
        uint256 cost = amount * pricePerShare / 1e18;
        paymentAsset.safeTransferFrom(msg.sender, beneficiary, cost);
        shareToken.transferFrom(beneficiary, msg.sender, amount);  // pre-approved
        sold += amount;
        emit Bought(msg.sender, amount, cost);
    }
}
```

**Defaults:**
- `pricePerShare = 1_000_000` (1 USDC/share with USDC's 6 decimals = $1)
- `maxShares = 300_000 * 10**18` (30% of supply)
- Round lasts 7 days, but for demo we set 1 hour and use small numbers

## 7. `RevenueVault`

The cashflow account. Receives x402 settlements, snapshots holders, distributes.

```solidity
contract RevenueVault is Ownable {
    ERC20      public immutable paymentAsset;     // USDC on Base
    ShareToken public immutable shareToken;
    uint256    public immutable agentTokenId;

    struct Snapshot {
        uint256 sharesSnapshotId;
        uint256 balanceAtSnapshot;
        uint64  ts;
        bool    distributed;
    }

    Snapshot[] public snapshots;

    /// Index of last distributed snapshot per holder, to compute claims.
    mapping(address => uint256) public lastClaimed;

    event Received(uint256 amount, address from);
    event Snapped(uint256 indexed snapshotId, uint256 balance);
    event Distributed(uint256 indexed snapshotId, address indexed holder, uint256 amount);

    /// Anyone can fund the vault by transferring USDC; or paid-via-x402.
    /// This function exists for explicit pay-in.
    function fund(uint256 amount) external {
        paymentAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit Received(amount, msg.sender);
    }

    /// Called by KeeperHub workflow weekly. Permissionless to allow user-triggered fallback.
    function snap() external {
        uint256 sid = shareToken.snapshot();
        uint256 bal = paymentAsset.balanceOf(address(this));
        snapshots.push(Snapshot(sid, bal, uint64(block.timestamp), false));
        emit Snapped(sid, bal);
    }

    /// Pull-pattern: each holder claims their share for a given snapshot.
    function claim(uint256 snapshotIdx) external {
        Snapshot storage s = snapshots[snapshotIdx];
        require(!_alreadyClaimed(msg.sender, snapshotIdx), "claimed");
        uint256 holderShares = shareToken.balanceOfAt(msg.sender, s.sharesSnapshotId);
        uint256 totalShares  = shareToken.totalSupplyAt(s.sharesSnapshotId);
        uint256 amount = s.balanceAtSnapshot * holderShares / totalShares;
        if (amount > 0) {
            paymentAsset.safeTransfer(msg.sender, amount);
            emit Distributed(snapshotIdx, msg.sender, amount);
        }
        _markClaimed(msg.sender, snapshotIdx);
    }

    /// Push-pattern: KeeperHub iterates holders and calls distributeTo() per holder.
    /// Used when we want one-tx UX for shareholders.
    function distributeTo(uint256 snapshotIdx, address holder) external {
        // similar logic; idempotent
    }
}
```

**Why pull + push?** Pull is gas-cheap; KeeperHub does the push for the demo so judges see it auto-happen, and shareholders never have to claim. In production, both paths are useful.

**Accounting test cases:**
- 3 holders with 70/20/10% → snap 100 USDC → distributions are 70/20/10 USDC, no rounding loss > 1 wei.
- Holder buys mid-week → balanceOfAt returns correct historical balance.
- Holder sells before snapshot → seller doesn't get the dividend; buyer doesn't either if buy was after snap. Standard snapshot behavior.

## 8. `Marketplace`

Whole-agent buyout. The headline flow.

```solidity
contract Marketplace {
    AgentNFT public immutable agentNft;
    ERC20    public immutable paymentAsset;
    address  public immutable teeOracle;        // can attest re-encrypt proofs

    struct Bid {
        address bidder;
        uint256 price;        // for the iNFT (does NOT include shares; see note)
        bytes   bidderPubkey; // for re-encrypt sealing
        uint64  expiresAt;
    }

    mapping(uint256 => Bid) public bestBid;       // tokenId → highest bid

    event BidPosted(uint256 indexed tokenId, address indexed bidder, uint256 price);
    event Acquired(uint256 indexed tokenId, address indexed acquirer);

    function postBid(
        uint256 tokenId,
        uint256 price,
        bytes calldata bidderPubkey,
        uint64 expiresAt
    ) external {
        // pull escrow into this contract
        paymentAsset.safeTransferFrom(msg.sender, address(this), price);
        // refund prior best
        if (bestBid[tokenId].bidder != address(0)) {
            paymentAsset.safeTransfer(bestBid[tokenId].bidder, bestBid[tokenId].price);
        }
        bestBid[tokenId] = Bid(msg.sender, price, bidderPubkey, expiresAt);
        emit BidPosted(tokenId, msg.sender, price);
    }

    /// Owner accepts. Triggers TEE re-encryption + iTransfer + payment release.
    function accept(
        uint256 tokenId,
        bytes calldata transferValidityProof
    ) external {
        require(agentNft.ownerOf(tokenId) == msg.sender, "not owner");
        Bid memory b = bestBid[tokenId];
        require(b.bidder != address(0), "no bid");
        require(block.timestamp < b.expiresAt, "expired");

        // delegate iTransfer with the proof. Will revert if the TEE attestation is bad.
        agentNft.iTransfer(tokenId, b.bidder, transferValidityProof);

        // release escrow
        paymentAsset.safeTransfer(msg.sender, b.price);
        delete bestBid[tokenId];

        emit Acquired(tokenId, b.bidder);
    }
}
```

**Note on shares:** Acquiring the iNFT does **not** automatically acquire the 1M shares. Shareholders still earn revenue. We deliberately separate these:
- Acquirer takes the iNFT (they control upgrades, can re-LoRA the model, control authorizeUsage)
- Shareholders still earn revenue
- Acquirer can launch a tender offer for the shares separately if they want full ownership

This is a feature, not a bug — it mirrors real markets (a CEO change doesn't dilute stockholders). For demo simplicity we focus on the iNFT transfer; tender offers are stretch.

## 9. `AgentRegistry`

```solidity
contract AgentRegistry {
    struct AgentInfo {
        address shareToken;
        address vaultBase;       // RevenueVault on Base (cross-chain pointer)
        bytes32 ensNameHash;     // namehash of the ticker
        address operator;
        uint64  createdAt;
    }
    mapping(uint256 => AgentInfo) public info;

    event Registered(uint256 indexed tokenId, address shareToken, address vault, bytes32 ensNameHash);

    function register(
        uint256 tokenId,
        address shareToken,
        address vaultBase,
        bytes32 ensNameHash
    ) external { /* only operator at mint time */ }
}
```

## 10. ERC-8004 registration

KeeperHub publishes our agent in the **ERC-8004 agent registry** so other agents can discover it via MCP and pay to call it.

The registration call is:

```solidity
// pseudo — actual ABI per ERC-8004
agentRegistry.register({
    name: "auditor.stratum.eth",
    capabilities: ["solidity_audit"],
    pricing: { perCall: 1_000_000, asset: USDC_BASE },
    paymentRails: ["x402", "mpp"],
    discoveryURL: "https://stratum.app/agent/AUDIT/.well-known/agent.json"
});
```

The registration cost is paid by the operator at mint.

## 11. Deployment plan

| Order | Contract | Network | Notes |
|---|---|---|---|
| 1 | `AgentNFT` (forked impl) | 0G Chain Galileo | One global instance for all Stratum agents |
| 2 | `Fractionalizer` | 0G Chain | Singleton |
| 3 | `Marketplace` | 0G Chain | Singleton |
| 4 | `AgentRegistry` | 0G Chain | Singleton |
| 5 | `IPOSale` | Base | One per agent IPO |
| 6 | `RevenueVault` | Base | One per agent |
| 7 | `ShareToken` | 0G Chain | Created by `Fractionalizer.fractionalize()` |
| 8 | `StratumResolver` | Sepolia | Singleton ENS resolver (CCIP-Read) |

Foundry `forge script DeployStratum.s.sol --broadcast` per network; addresses persisted to `deployments/<network>.json` and committed.

## 12. Test plan

- `forge test` covers: mint, fractionalize, IPO, fund vault, snap, claim (3-holder math), iTransfer with mock attestation clears `authorizeUsage`.
- Cross-chain we test by deploying both sides locally with Anvil + a Foundry script that simulates "x402 payment received → vault.balance increased."
- Integration test: run a happy-path script that: mints → fractionalizes → IPOs → 5 paid inferences → snap → distribute → assert holder balances match.

## 13. Security notes (honest, not exhaustive)

- **Reentrancy:** Snapshot/distribute uses pull-pattern primarily, push-pattern uses ReentrancyGuard. USDC is non-reentrant but we don't rely on that.
- **Front-running on IPO:** Fixed price means no slippage; private mempool not needed.
- **Front-running on Marketplace acceptance:** Operator could see a high bid, do `authorizeUsage` to themselves before accepting (so they retain access post-sale). **This is a real attack.** Mitigation: `authorizeUsage` is cleared on `iTransfer` per ERC-7857 spec, so the attack doesn't work. Verify in test.
- **Dust attacks on RevenueVault:** Anyone can `fund()`. Spam doesn't break math. No DoS vector.
- **Unaudited.** This is hackathon code. We label it as such in the README and frontend.
