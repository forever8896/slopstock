// Copyright (c), Mysten Labs, Inc.
// SPDX-License-Identifier: Apache-2.0
//
// agent_seal::allowlist — Seal allowlist access-control policy for agent state.
//
// Adapted directly from Mysten Labs' canonical Seal allowlist example:
//   MystenLabs/seal @ examples/move/sources/allowlist.move (module walrus::allowlist)
//   + examples/move/sources/utils.move (is_prefix, inlined below).
// The only changes vs. the upstream example are:
//   - module renamed walrus::allowlist -> agent_seal::allowlist
//   - is_prefix inlined into this module (no separate utils module / dependency)
// The seal_approve signature is kept IDENTICAL to upstream so that the operator's
// SealCipher.decrypt moveCall (apps/operator/src/storage/seal.ts) works unchanged:
//   `${packageId}::allowlist::seal_approve(id: vector<u8>, allowlist: &Allowlist, ctx)`
//
// !!! UNVERIFIED-COMPILE: this file was authored WITHOUT a Sui toolchain present
// (no `sui` CLI in the authoring environment), so it has NOT been run through
// `sui move build`. Treat the build+publish as a manual step — see
// apps/operator/scripts/seal-publish-policy.ts for the exact CLI sequence.

module agent_seal::allowlist;

use std::string::String;
use sui::dynamic_field as df;

const EInvalidCap: u64 = 0;
const ENoAccess: u64 = 1;
const EDuplicate: u64 = 2;
const MARKER: u64 = 3;

public struct Allowlist has key {
    id: UID,
    name: String,
    list: vector<address>,
}

public struct Cap has key {
    id: UID,
    allowlist_id: ID,
}

//////////////////////////////////////////
/////// Simple allowlist with an admin cap

/// Create an allowlist with an admin cap.
/// The associated key-ids are [pkg id]::[allowlist id][nonce] for any nonce (thus
/// many key-ids can be created for the same allowlist).
public fun create_allowlist(name: String, ctx: &mut TxContext): Cap {
    let allowlist = Allowlist {
        id: object::new(ctx),
        list: vector[],
        name: name,
    };
    let cap = Cap {
        id: object::new(ctx),
        allowlist_id: object::id(&allowlist),
    };
    transfer::share_object(allowlist);
    cap
}

// convenience function to create an allowlist and send the cap back to sender
// (simpler ptb for cli / @mysten/sui programmatic publish helper)
entry fun create_allowlist_entry(name: String, ctx: &mut TxContext) {
    transfer::transfer(create_allowlist(name, ctx), ctx.sender());
}

public fun add(allowlist: &mut Allowlist, cap: &Cap, account: address) {
    assert!(cap.allowlist_id == object::id(allowlist), EInvalidCap);
    assert!(!allowlist.list.contains(&account), EDuplicate);
    allowlist.list.push_back(account);
}

// convenience entry wrapper so the cap holder can add an address from the cli /
// programmatic helper without composing a PTB by hand.
entry fun add_entry(allowlist: &mut Allowlist, cap: &Cap, account: address) {
    add(allowlist, cap, account);
}

public fun remove(allowlist: &mut Allowlist, cap: &Cap, account: address) {
    assert!(cap.allowlist_id == object::id(allowlist), EInvalidCap);
    allowlist.list = allowlist.list.filter!(|x| x != account);
}

//////////////////////////////////////////////////////////
/// Access control
/// key format: [pkg id]::[allowlist id][random nonce]
/// (Alternative key format: [pkg id]::[creator address][random nonce] - see private_data.move)

public fun namespace(allowlist: &Allowlist): vector<u8> {
    allowlist.id.to_bytes()
}

/// Returns true if `prefix` is a prefix of `word`.
/// Inlined from Mysten's examples/move/sources/utils.move (walrus::utils::is_prefix).
fun is_prefix(prefix: vector<u8>, word: vector<u8>): bool {
    if (prefix.length() > word.length()) {
        return false
    };
    let mut i = 0;
    while (i < prefix.length()) {
        if (prefix[i] != word[i]) {
            return false
        };
        i = i + 1;
    };
    true
}

/// All allowlisted addresses can access all IDs with the prefix of the allowlist.
fun approve_internal(caller: address, id: vector<u8>, allowlist: &Allowlist): bool {
    // Check if the id has the right prefix (namespaced under the allowlist object id).
    let namespace = namespace(allowlist);
    if (!is_prefix(namespace, id)) {
        return false
    };

    // Check if user is in the allowlist.
    allowlist.list.contains(&caller)
}

entry fun seal_approve(id: vector<u8>, allowlist: &Allowlist, ctx: &TxContext) {
    assert!(approve_internal(ctx.sender(), id, allowlist), ENoAccess);
}

/// Encapsulate a blob into a Sui object and attach it to the allowlist.
public fun publish(allowlist: &mut Allowlist, cap: &Cap, blob_id: String) {
    assert!(cap.allowlist_id == object::id(allowlist), EInvalidCap);
    df::add(&mut allowlist.id, blob_id, MARKER);
}

#[test_only]
public fun new_allowlist_for_testing(ctx: &mut TxContext): Allowlist {
    Allowlist {
        id: object::new(ctx),
        name: b"test".to_string(),
        list: vector[],
    }
}

#[test_only]
public fun new_cap_for_testing(ctx: &mut TxContext, allowlist: &Allowlist): Cap {
    Cap {
        id: object::new(ctx),
        allowlist_id: object::id(allowlist),
    }
}

#[test_only]
public fun destroy_for_testing(allowlist: Allowlist, cap: Cap) {
    let Allowlist { id, .. } = allowlist;
    object::delete(id);
    let Cap { id, .. } = cap;
    object::delete(id);
}

#[test]
fun test_approve() {
    let ctx = &mut tx_context::dummy();
    let mut allowlist = new_allowlist_for_testing(ctx);
    let cap = new_cap_for_testing(ctx, &allowlist);

    // operator address is in the allowlist
    allowlist.add(&cap, @0x2);

    // id must be namespaced under the allowlist object id (prefix check)
    let mut id = namespace(&allowlist);
    id.push_back(11); // arbitrary nonce / utf8(tokenId) suffix

    // allowlisted caller with a correctly-namespaced id is approved
    assert!(approve_internal(@0x2, id, &allowlist), 0);
    // non-allowlisted caller is rejected even with a valid prefix
    assert!(!approve_internal(@0x1, id, &allowlist), 1);
    // wrong prefix is rejected even for an allowlisted caller
    assert!(!approve_internal(@0x2, b"deadbeef", &allowlist), 2);

    destroy_for_testing(allowlist, cap);
}
