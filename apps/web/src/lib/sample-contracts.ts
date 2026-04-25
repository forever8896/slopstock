/**
 * Demo Solidity contracts. Each ships with a known bug so the audit agent
 * has something concrete to find. Spec: docs/08-hero-agent.md §6.
 */

export interface SampleContract {
  id: string;
  label: string;
  bug: string;
  source: string;
}

export const sampleContracts: SampleContract[] = [
  {
    id: "vault-reentrancy",
    label: "DemoVault.sol",
    bug: "classic reentrancy in withdraw()",
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DemoVault {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 bal = balances[msg.sender];
        require(bal > 0, "no balance");

        // BUG: external call before state update
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "transfer failed");

        balances[msg.sender] = 0;
    }
}
`,
  },
  {
    id: "token-zero-check",
    label: "DemoToken.sol",
    bug: "missing zero-address check on transfer",
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DemoToken {
    mapping(address => uint256) public balanceOf;
    uint256 public totalSupply;

    constructor(uint256 supply) {
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
    }

    function transfer(address to, uint256 amount) external {
        // BUG: no zero-address guard — tokens can be burned by mistake
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}
`,
  },
  {
    id: "voting-race",
    label: "DemoVoting.sol",
    bug: "commit/reveal race condition",
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DemoVoting {
    mapping(address => bytes32) public commitments;
    mapping(uint8 => uint256) public tally;
    uint64 public revealUntil;

    function commit(bytes32 hash) external {
        commitments[msg.sender] = hash;
    }

    function reveal(uint8 choice, bytes32 nonce) external {
        require(block.timestamp < revealUntil, "reveal closed");
        bytes32 expected = keccak256(abi.encodePacked(choice, nonce, msg.sender));
        require(commitments[msg.sender] == expected, "bad reveal");

        // BUG: no replay guard — the same commitment can be revealed multiple times
        tally[choice] += 1;
    }
}
`,
  },
];
