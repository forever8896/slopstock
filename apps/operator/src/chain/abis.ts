/**
 * Hand-written ABI snippets for the Stratum contracts the operator reads/writes.
 *
 * Kept minimal — only the functions the operator actually calls. Full ABIs will
 * eventually live in @stratum/contracts-types via wagmi-cli generation; until
 * then this file is the source of truth for the operator's contract calls.
 */

export const agentNftAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "isAuthorized",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "authorizeUsage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "user", type: "address" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revokeUsage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "user", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "expectedMeasurement",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

export const agentRegistryAbi = [
  {
    type: "function",
    name: "info",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "shareToken", type: "address" },
          { name: "vaultBase", type: "address" },
          { name: "ensNameHash", type: "bytes32" },
          { name: "operator", type: "address" },
          { name: "createdAt", type: "uint64" },
        ],
      },
    ],
  },
] as const;
