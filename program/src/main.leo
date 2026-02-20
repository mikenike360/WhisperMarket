import credits.aleo;

program whisper_market_v2.aleo {
    // ============================================================================
    // CONDITIONAL TOKENS AMM DOCUMENTATION
    // ============================================================================
    // This program implements a Polymarket-style conditional-token AMM for prediction markets.
    //
    // Conditional-Token Solvency:
    // - While market is OPEN:
    //   - market_collateral_pool(m) == market_total_yes_supply(m) == market_total_no_supply(m).
    //   - Minting collateral increases pool and both supplies by NET collateral (after mint fee).
    //   - Merging burns equal YES+NO and returns collateral 1:1 (decrements pool and both supplies).
    // - After RESOLVED (Settlement at resolve):
    //   - At resolve: reserves are zeroed and total supplies reduced by reserve amounts; pool unchanged.
    //   - remaining_winning_supply is user-only (pool no longer backs pool-owned shares).
    //   - Solvency: market_collateral_pool(m) >= remaining_winning_supply(m). Excess = pool - remaining_winning_supply = former winning reserve; creator may withdraw via withdraw_excess_private.
    //   - Losing shares are worthless.
    //
    // Reserve Realism:
    // - market_yes_reserve and market_no_reserve are the AMM pool's share balances ONLY (not total supply).
    // - AMM trades update these reserves and preserve x*y ≈ k (with fees/rounding).
    // - Merge does not change reserves (user shares are not in the pool).
    //
    // Fees:
    // - Single fee in bps (market_fee_bps): mint as collateral fee; swap as fee-on-input (effective input discount).
    // - Mint: fee in collateral goes to market_fee_collected; user receives net collateral; mint only for net.
    // - Swap: fee applied to input (effective_input = amount * (FEE_SCALE - fee_bps) / FEE_SCALE); full input enters reserves;
    //   output from constant-product on effective input; fee remains in pool reserves by construction.
    // - market_fee_collected never reduces backing of outstanding shares.
    //
    // Creator incentives:
    // - market_creator_liquidity: creator-owned collateral set at init; withdrawable after RESOLVED (withdraw_creator_liq_private). Not used for redemption.
    // - Mint fees: withdraw_fees_private (from market_fee_collected). Excess pool: withdraw_excess_private (rare surplus). No creator withdrawal while OPEN.
    //
    // Bond Isolation:
    // - market_bond(m) is set only in init and never touched after.
    //
    // Replay Protection:
    // - Every position mutation validates input Position against on-chain mappings before applying changes.
    // - Position key = hash(market_id, owner).
    //
    // Overflow policy: MAX_POOL (2^64-1) is the single cap for pool, supplies, reserves, position balances, user_collateral.
    // All additions use assert(a <= MAX_POOL - b) before the add. Multiplications are safe since operands <= MAX_POOL.
    // u128->u64 casts guarded by MAX_U64.
    // ============================================================================

    // Constants
    const ADMIN: address = aleo12c37wnemh8568n6cmnlcsglh9x8fj6yc2wtzfm3fz9342j7sdczqjpv05a; // Admin address
    const SCALE: u64 = 10000u64; // Price scale (basis points)
    const MAX_COLLATERAL: u64 = 1000000000000u64; // 1 trillion (practical limit)
    const STATUS_OPEN: u8 = 0u8;
    const STATUS_RESOLVED: u8 = 1u8;
    const STATUS_PAUSED: u8 = 2u8;
    const MAX_U64: u128 = 18446744073709551615u128; // u64::MAX; all u128->u64 casts must be preceded by assert(x <= MAX_U64)
    // AMM Constants
    const FEE_SCALE: u64 = 10000u64; // Basis points scale (reuse existing SCALE)
    const MIN_LIQUIDITY: u128 = 1000u128; // Minimum liquidity to prevent division by zero and ensure market exists
    const MAX_POOL: u128 = 18446744073709551615u128; // 2^64-1; cap for pool/supplies/reserves to avoid product overflow
    const MAX_FEE_BPS: u64 = 1000u64; // Maximum 10% fee (safety limit)

    // Market state
    mapping market_status: field => u8; // 0=open, 1=resolved, 2=paused
    mapping market_outcome: field => bool; // true=YES, false=NO
    mapping market_collateral_pool: field => u128; // Backing pool for winner redemptions only (excludes bonds, fees, creator_liquidity)
    mapping market_metadata_hash: field => field; // Metadata hash for indexers
    mapping market_bond: field => u128; // Creation bond (permanently locked, never touched by swaps/withdrawals)

    // AMM State
    mapping market_yes_reserve: field => u128; // YES token reserve (constant product AMM)
    mapping market_no_reserve: field => u128; // NO token reserve (constant product AMM)
    mapping market_fee_bps: field => u64; // bps: mint (collateral); swap (fee-on-input, effective input discount)
    mapping market_fee_collected: field => u128; // protocol fees collected (isolated from pool and bonds)
    mapping market_initial_liquidity: field => u128; // initial liquidity deposit
    mapping market_total_yes_supply: field => u128; // total outstanding YES shares
    mapping market_total_no_supply: field => u128; // total outstanding NO shares

    // Market enumeration
    mapping market_index: u64 => field; // Index => market_id
    mapping total_markets: u64 => u64;  // total_markets[0] = count
    
    // Market creator tracking (for market ID uniqueness and admin functions)
    mapping market_creator: field => address;
    mapping market_creator_liquidity: field => u128; // creator-owned incentive collateral; withdrawable after RESOLVED; not used for redemption

    // Global user collateral (not market-specific)
    mapping user_collateral: field => u128; // address as field => balance

    // On-chain position state: keyed by hash(market_id, owner)
    // This prevents position replay attacks and ensures state correctness
    // Using separate mappings since Leo doesn't support tuples in mappings
    mapping position_yes_shares: field => u128; // position key => yes_shares
    mapping position_no_shares: field => u128; // position key => no_shares
    mapping position_collateral_committed: field => u128; // position key => collateral_committed
    mapping position_payout_claimed: field => bool; // position key => payout_claimed
    mapping position_exists: field => bool; // position key => exists flag

    record Position {
        owner: address,
        market_id: field,
        yes_shares: u128,
        no_shares: u128,
        collateral_committed: u128,
        payout_claimed: bool
    }

    // May be unset until first open_position_private or first trade; treat missing as SCALE/2.
    mapping last_price_update: field => u64;
    mapping last_resolve: field => bool;

    // Constructor is intentionally empty and upgrade-safe.
    // New mappings are backward-compatible (Leo treats unset as default).
    @admin(address="aleo12c37wnemh8568n6cmnlcsglh9x8fj6yc2wtzfm3fz9342j7sdczqjpv05a")
    async constructor() {
    }

    async transition deposit_global_private(
        credit_record: credits.aleo/credits,
        amount: u64
    ) -> (credits.aleo/credits, Future) {
        assert(amount > 0u64);
        assert(amount <= MAX_COLLATERAL);

        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, amount);
        let change_record = result.0;
        let caller_f: field = self.signer as field;

        return (change_record, async {
            result.1.await();

            if user_collateral.contains(caller_f) {
                let current: u128 = user_collateral.get(caller_f);
                assert(current <= MAX_POOL - (amount as u128));
                user_collateral.set(caller_f, current + amount as u128);
            } else {
                user_collateral.set(caller_f, amount as u128);
            }
        });
    }

    // withdraw_global_private: user_collateral check and debit MUST happen before transfer await.
    // Transition commits only if the full async block succeeds; state is debited before transfer await.
    async transition withdraw_global_private(
        amount: u64
    ) -> (credits.aleo/credits, Future) {
        assert(amount > 0u64);
        let caller_f: field = self.signer as field;

        let result = credits.aleo/transfer_public_to_private(self.signer, amount);
        let credit_record = result.0;

        return (credit_record, async {
            assert(user_collateral.contains(caller_f));
            let current: u128 = user_collateral.get(caller_f);
            assert(current >= amount as u128);
            user_collateral.set(caller_f, current - amount as u128);
            result.1.await();
        });
    }

    async transition init(
        initial_liquidity: u64,
        bond_amount: u64,
        creator_liquidity: u64,
        fee_bps: u64,
        metadata_hash: field,
        salt: field,
        credit_record: credits.aleo/credits
    ) -> (credits.aleo/credits, Future) {
        assert(initial_liquidity >= MIN_LIQUIDITY as u64);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(bond_amount > 0u64);

        assert(bond_amount <= MAX_COLLATERAL);
        assert(initial_liquidity <= MAX_COLLATERAL);
        assert(bond_amount <= MAX_COLLATERAL - initial_liquidity);
        let bi: u64 = bond_amount + initial_liquidity;
        assert(bi >= bond_amount);

        assert(creator_liquidity <= MAX_COLLATERAL);
        assert(creator_liquidity as u128 <= MAX_POOL);
        assert(creator_liquidity <= MAX_COLLATERAL - bi);
        let total_transfer: u64 = bi + creator_liquidity;
        assert(total_transfer >= bi);

        assert(initial_liquidity as u128 <= MAX_POOL);
        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, total_transfer);
        let change_record = result.0;
        let creator: address = self.signer; // Capture creator before async block

        return (change_record, async {
            result.1.await();

            // Domain-separated multi-hash construction (collision-resistant)
            let h1: field = BHP256::hash_to_field(1field + metadata_hash);
            let h2: field = BHP256::hash_to_field(2field + salt);
            let h3: field = BHP256::hash_to_field(3field + (creator as field));
            let combined: field = BHP256::hash_to_field(4field + h1 + 5field + h2 + 6field + h3);
            let market_id: field = BHP256::hash_to_field(7field + combined);

            assert(!market_status.contains(market_id));
            assert(!market_metadata_hash.contains(market_id));
            assert(!market_bond.contains(market_id));

            // Initial liquidity = collateral that mints initial_liquidity YES + initial_liquidity NO
            // assigned to pool reserves (LP-style). After init: pool_collateral == total_yes == total_no == initial_liquidity.
            let initial_liquidity_u128: u128 = initial_liquidity as u128;
            market_status.set(market_id, STATUS_OPEN);
            market_collateral_pool.set(market_id, initial_liquidity_u128);
            market_yes_reserve.set(market_id, initial_liquidity_u128);
            market_no_reserve.set(market_id, initial_liquidity_u128);
            market_total_yes_supply.set(market_id, initial_liquidity_u128);
            market_total_no_supply.set(market_id, initial_liquidity_u128);
            market_fee_bps.set(market_id, fee_bps);
            market_initial_liquidity.set(market_id, initial_liquidity_u128);
            market_metadata_hash.set(market_id, metadata_hash);
            market_bond.set(market_id, bond_amount as u128);
            market_creator.set(market_id, creator); // Track creator for admin/debugging
            market_creator_liquidity.set(market_id, creator_liquidity as u128);

            assert_eq(market_collateral_pool.get(market_id), market_total_yes_supply.get(market_id));
            assert_eq(market_total_yes_supply.get(market_id), market_total_no_supply.get(market_id));

            // Enumeration (no ternary get)
            if total_markets.contains(0u64) {
                let current_count: u64 = total_markets.get(0u64);
                market_index.set(current_count, market_id);
                total_markets.set(0u64, current_count + 1u64);
            } else {
                market_index.set(0u64, market_id);
                total_markets.set(0u64, 1u64);
            }
        });
    }

    async transition open_position_private(
        market_id: field,
        status_hint: u8
    ) -> (Position, Future) {
        assert(status_hint == STATUS_OPEN);

        // Compute position key for on-chain storage
        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + (self.signer as field));

        let new_position = Position {
            owner: self.signer,
            market_id: market_id,
            yes_shares: 0u128,
            no_shares: 0u128,
            collateral_committed: 0u128,
            payout_claimed: false
        };

        return (new_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);
            if !last_price_update.contains(market_id) {
                last_price_update.set(market_id, SCALE / 2u64);
            }

            // Initialize on-chain position state if it doesn't exist
            // If it exists, verify empty state; allow re-open after redeem (claimed and zeroed)
            if position_exists.contains(pos_key) {
                let existing_yes: u128 = position_yes_shares.get(pos_key);
                let existing_no: u128 = position_no_shares.get(pos_key);
                let existing_committed: u128 = position_collateral_committed.get(pos_key);
                let existing_claimed: bool = position_payout_claimed.get(pos_key);
                if existing_claimed {
                    // Re-open after redeem: must be fully zeroed
                    assert(existing_yes == 0u128);
                    assert(existing_no == 0u128);
                    assert(existing_committed == 0u128);
                    position_payout_claimed.set(pos_key, false);
                } else {
                    assert(existing_yes == 0u128);
                    assert(existing_no == 0u128);
                    assert(existing_committed == 0u128);
                }
            } else {
                // Initialize new position state on-chain
                position_yes_shares.set(pos_key, 0u128);
                position_no_shares.set(pos_key, 0u128);
                position_collateral_committed.set(pos_key, 0u128);
                position_payout_claimed.set(pos_key, false);
                position_exists.set(pos_key, true);
            }
        });
    }

    // Reserve hints (yes_reserve, no_reserve) in mint_pairs are for anti-stale consistency only;
    // mint does not modify reserves. Caller must pass current on-chain reserves.
    async transition mint_pairs_private(
        market_id: field,
        existing_position: Position,
        collateral_in: u64,
        min_yes_out: u128,
        min_no_out: u128,
        yes_reserve: u128,
        no_reserve: u128,
        fee_bps: u64,
        status_hint: u8
    ) -> (Position, Future) {
        assert_eq(existing_position.owner, self.signer);
        assert(!existing_position.payout_claimed);
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let caller_f: field = caller as field;
        let existing_market_id: field = existing_position.market_id;

        assert(collateral_in > 0u64);
        assert(collateral_in <= MAX_COLLATERAL);
        assert_eq(existing_market_id, market_id);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(fee_bps <= FEE_SCALE);
        assert(status_hint == STATUS_OPEN);
        assert(min_yes_out <= MAX_POOL);
        assert(min_no_out <= MAX_POOL);
        assert(yes_reserve <= MAX_POOL);
        assert(no_reserve <= MAX_POOL);

        let collateral_in_u128: u128 = collateral_in as u128;
        let fee: u128 = (collateral_in_u128 * fee_bps as u128) / FEE_SCALE as u128;
        assert(collateral_in_u128 >= fee);
        let net: u128 = collateral_in_u128 - fee;

        let total_yes_for_user: u128 = net;
        let total_no_for_user: u128 = net;

        assert(total_yes_for_user >= min_yes_out);
        assert(total_no_for_user >= min_no_out);

        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + caller_f);

        assert(existing_yes_shares <= MAX_POOL - total_yes_for_user);
        assert(existing_no_shares <= MAX_POOL - total_no_for_user);
        assert(existing_committed <= MAX_POOL - net);
        let new_yes: u128 = existing_yes_shares + total_yes_for_user;
        let new_no: u128 = existing_no_shares + total_no_for_user;
        let new_committed: u128 = existing_committed + net;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: new_yes,
            no_shares: new_no,
            collateral_committed: new_committed,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);
            assert_eq(market_fee_bps.get(market_id), fee_bps);

            assert(position_exists.contains(pos_key));
            let on_chain_yes: u128 = position_yes_shares.get(pos_key);
            let on_chain_no: u128 = position_no_shares.get(pos_key);
            let on_chain_committed: u128 = position_collateral_committed.get(pos_key);
            let on_chain_claimed: bool = position_payout_claimed.get(pos_key);
            assert_eq(on_chain_yes, existing_yes_shares);
            assert_eq(on_chain_no, existing_no_shares);
            assert_eq(on_chain_committed, existing_committed);
            assert_eq(on_chain_claimed, existing_payout_claimed);

            assert(user_collateral.contains(caller_f));
            let current_user: u128 = user_collateral.get(caller_f);
            assert(current_user >= collateral_in_u128);
            user_collateral.set(caller_f, current_user - collateral_in_u128);

            if fee > 0u128 {
                if market_fee_collected.contains(market_id) {
                    let current_fees: u128 = market_fee_collected.get(market_id);
                    assert(current_fees <= MAX_POOL - fee);
                    market_fee_collected.set(market_id, current_fees + fee);
                } else {
                    assert(fee <= MAX_POOL);
                    market_fee_collected.set(market_id, fee);
                }
            }

            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                assert(current_pool <= MAX_POOL - net);
                market_collateral_pool.set(market_id, current_pool + net);
            } else {
                assert(net <= MAX_POOL);
                market_collateral_pool.set(market_id, net);
            }

            let curr_total_yes: u128 = market_total_yes_supply.get(market_id);
            let curr_total_no: u128 = market_total_no_supply.get(market_id);
            assert(curr_total_yes <= MAX_POOL - net);
            assert(curr_total_no <= MAX_POOL - net);
            market_total_yes_supply.set(market_id, curr_total_yes + net);
            market_total_no_supply.set(market_id, curr_total_no + net);

            assert_eq(market_collateral_pool.get(market_id), market_total_yes_supply.get(market_id));
            assert_eq(market_total_yes_supply.get(market_id), market_total_no_supply.get(market_id));

            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);

            position_yes_shares.set(pos_key, new_yes);
            position_no_shares.set(pos_key, new_no);
            position_collateral_committed.set(pos_key, new_committed);
            position_payout_claimed.set(pos_key, existing_payout_claimed);

            let price_yes_val: u128 = (no_reserve * SCALE as u128) / (yes_reserve + no_reserve);
            assert(price_yes_val <= MAX_U64);
            let price_yes: u64 = price_yes_val as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    // Mint collateral into equal YES+NO then swap NO->YES atomically. User receives only YES (net + yes_out).
    async transition mint_yes_only_private(
        market_id: field,
        existing_position: Position,
        collateral_in: u64,
        min_yes_out: u128,
        yes_reserve: u128,
        no_reserve: u128,
        fee_bps: u64,
        status_hint: u8
    ) -> (Position, Future) {
        assert_eq(existing_position.owner, self.signer);
        assert(!existing_position.payout_claimed);
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let caller_f: field = caller as field;
        let existing_market_id: field = existing_position.market_id;

        assert(collateral_in > 0u64);
        assert(collateral_in <= MAX_COLLATERAL);
        assert_eq(existing_market_id, market_id);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(fee_bps <= FEE_SCALE);
        assert(status_hint == STATUS_OPEN);
        assert(min_yes_out <= MAX_POOL);
        assert(yes_reserve <= MAX_POOL);
        assert(no_reserve <= MAX_POOL);

        let collateral_in_u128: u128 = collateral_in as u128;
        let fee: u128 = (collateral_in_u128 * fee_bps as u128) / FEE_SCALE as u128;
        assert(collateral_in_u128 >= fee);
        let net: u128 = collateral_in_u128 - fee;

        // Swap leg: swap net NO for YES (same math as swap_no_yes_private)
        let no_amount: u128 = net;
        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);
        assert(no_reserve <= MAX_POOL - no_amount);

        let no_effective: u128 = (no_amount * (FEE_SCALE as u128 - fee_bps as u128)) / FEE_SCALE as u128;
        assert(no_effective <= MAX_POOL);
        assert(no_effective > 0u128);

        let yes_out: u128 = (no_effective * yes_reserve) / (no_reserve + no_effective);
        assert(yes_out <= MAX_POOL);
        assert(yes_out >= min_yes_out);
        assert(yes_reserve >= yes_out);

        let no_reserve_new: u128 = no_reserve + no_amount;
        let yes_reserve_new: u128 = yes_reserve - yes_out;
        assert(no_reserve_new <= MAX_POOL);
        assert(yes_reserve_new <= MAX_POOL);

        let total_yes_for_user: u128 = net + yes_out;
        assert(existing_yes_shares <= MAX_POOL - total_yes_for_user);
        assert(existing_committed <= MAX_POOL - net);
        let new_yes: u128 = existing_yes_shares + total_yes_for_user;
        let new_no: u128 = existing_no_shares;
        let new_committed: u128 = existing_committed + net;

        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + caller_f);

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: new_yes,
            no_shares: new_no,
            collateral_committed: new_committed,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);
            assert_eq(market_fee_bps.get(market_id), fee_bps);

            assert(position_exists.contains(pos_key));
            let on_chain_yes: u128 = position_yes_shares.get(pos_key);
            let on_chain_no: u128 = position_no_shares.get(pos_key);
            let on_chain_committed: u128 = position_collateral_committed.get(pos_key);
            let on_chain_claimed: bool = position_payout_claimed.get(pos_key);
            assert_eq(on_chain_yes, existing_yes_shares);
            assert_eq(on_chain_no, existing_no_shares);
            assert_eq(on_chain_committed, existing_committed);
            assert_eq(on_chain_claimed, existing_payout_claimed);

            assert(user_collateral.contains(caller_f));
            let current_user: u128 = user_collateral.get(caller_f);
            assert(current_user >= collateral_in_u128);
            user_collateral.set(caller_f, current_user - collateral_in_u128);

            if fee > 0u128 {
                if market_fee_collected.contains(market_id) {
                    let current_fees: u128 = market_fee_collected.get(market_id);
                    assert(current_fees <= MAX_POOL - fee);
                    market_fee_collected.set(market_id, current_fees + fee);
                } else {
                    assert(fee <= MAX_POOL);
                    market_fee_collected.set(market_id, fee);
                }
            }

            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                assert(current_pool <= MAX_POOL - net);
                market_collateral_pool.set(market_id, current_pool + net);
            } else {
                assert(net <= MAX_POOL);
                market_collateral_pool.set(market_id, net);
            }

            let curr_total_yes: u128 = market_total_yes_supply.get(market_id);
            let curr_total_no: u128 = market_total_no_supply.get(market_id);
            assert(curr_total_yes <= MAX_POOL - net);
            assert(curr_total_no <= MAX_POOL - net);
            market_total_yes_supply.set(market_id, curr_total_yes + net);
            market_total_no_supply.set(market_id, curr_total_no + net);

            assert_eq(market_collateral_pool.get(market_id), market_total_yes_supply.get(market_id));
            assert_eq(market_total_yes_supply.get(market_id), market_total_no_supply.get(market_id));

            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);

            let no_amount_async: u128 = net;
            let no_effective_async: u128 = (no_amount_async * (FEE_SCALE as u128 - fee_bps as u128)) / FEE_SCALE as u128;
            let yes_out_async: u128 = (no_effective_async * yes_reserve) / (no_reserve + no_effective_async);
            let no_reserve_new_async: u128 = no_reserve + no_amount_async;
            let yes_reserve_new_async: u128 = yes_reserve - yes_out_async;

            market_yes_reserve.set(market_id, yes_reserve_new_async);
            market_no_reserve.set(market_id, no_reserve_new_async);

            position_yes_shares.set(pos_key, new_yes);
            position_no_shares.set(pos_key, new_no);
            position_collateral_committed.set(pos_key, new_committed);
            position_payout_claimed.set(pos_key, existing_payout_claimed);

            let price_yes_val: u128 = (no_reserve_new_async * SCALE as u128) / (yes_reserve_new_async + no_reserve_new_async);
            assert(price_yes_val <= MAX_U64);
            let price_yes: u64 = price_yes_val as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    // Mint collateral into equal YES+NO then swap YES->NO atomically. User receives only NO (net + no_out).
    async transition mint_no_only_private(
        market_id: field,
        existing_position: Position,
        collateral_in: u64,
        min_no_out: u128,
        yes_reserve: u128,
        no_reserve: u128,
        fee_bps: u64,
        status_hint: u8
    ) -> (Position, Future) {
        assert_eq(existing_position.owner, self.signer);
        assert(!existing_position.payout_claimed);
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let caller_f: field = caller as field;
        let existing_market_id: field = existing_position.market_id;

        assert(collateral_in > 0u64);
        assert(collateral_in <= MAX_COLLATERAL);
        assert_eq(existing_market_id, market_id);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(fee_bps <= FEE_SCALE);
        assert(status_hint == STATUS_OPEN);
        assert(min_no_out <= MAX_POOL);
        assert(yes_reserve <= MAX_POOL);
        assert(no_reserve <= MAX_POOL);

        let collateral_in_u128: u128 = collateral_in as u128;
        let fee: u128 = (collateral_in_u128 * fee_bps as u128) / FEE_SCALE as u128;
        assert(collateral_in_u128 >= fee);
        let net: u128 = collateral_in_u128 - fee;

        // Swap leg: swap net YES for NO (same math as swap_yes_no_private)
        let yes_amount: u128 = net;
        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);
        assert(yes_reserve <= MAX_POOL - yes_amount);

        let yes_effective: u128 = (yes_amount * (FEE_SCALE as u128 - fee_bps as u128)) / FEE_SCALE as u128;
        assert(yes_effective <= MAX_POOL);
        assert(yes_effective > 0u128);

        let no_out: u128 = (yes_effective * no_reserve) / (yes_reserve + yes_effective);
        assert(no_out <= MAX_POOL);
        assert(no_out >= min_no_out);
        assert(no_reserve >= no_out);

        let yes_reserve_new: u128 = yes_reserve + yes_amount;
        let no_reserve_new: u128 = no_reserve - no_out;
        assert(yes_reserve_new <= MAX_POOL);
        assert(no_reserve_new <= MAX_POOL);

        let total_no_for_user: u128 = net + no_out;
        assert(existing_no_shares <= MAX_POOL - total_no_for_user);
        assert(existing_committed <= MAX_POOL - net);
        let new_yes: u128 = existing_yes_shares;
        let new_no: u128 = existing_no_shares + total_no_for_user;
        let new_committed: u128 = existing_committed + net;

        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + caller_f);

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: new_yes,
            no_shares: new_no,
            collateral_committed: new_committed,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);
            assert_eq(market_fee_bps.get(market_id), fee_bps);

            assert(position_exists.contains(pos_key));
            let on_chain_yes: u128 = position_yes_shares.get(pos_key);
            let on_chain_no: u128 = position_no_shares.get(pos_key);
            let on_chain_committed: u128 = position_collateral_committed.get(pos_key);
            let on_chain_claimed: bool = position_payout_claimed.get(pos_key);
            assert_eq(on_chain_yes, existing_yes_shares);
            assert_eq(on_chain_no, existing_no_shares);
            assert_eq(on_chain_committed, existing_committed);
            assert_eq(on_chain_claimed, existing_payout_claimed);

            assert(user_collateral.contains(caller_f));
            let current_user: u128 = user_collateral.get(caller_f);
            assert(current_user >= collateral_in_u128);
            user_collateral.set(caller_f, current_user - collateral_in_u128);

            if fee > 0u128 {
                if market_fee_collected.contains(market_id) {
                    let current_fees: u128 = market_fee_collected.get(market_id);
                    assert(current_fees <= MAX_POOL - fee);
                    market_fee_collected.set(market_id, current_fees + fee);
                } else {
                    assert(fee <= MAX_POOL);
                    market_fee_collected.set(market_id, fee);
                }
            }

            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                assert(current_pool <= MAX_POOL - net);
                market_collateral_pool.set(market_id, current_pool + net);
            } else {
                assert(net <= MAX_POOL);
                market_collateral_pool.set(market_id, net);
            }

            let curr_total_yes: u128 = market_total_yes_supply.get(market_id);
            let curr_total_no: u128 = market_total_no_supply.get(market_id);
            assert(curr_total_yes <= MAX_POOL - net);
            assert(curr_total_no <= MAX_POOL - net);
            market_total_yes_supply.set(market_id, curr_total_yes + net);
            market_total_no_supply.set(market_id, curr_total_no + net);

            assert_eq(market_collateral_pool.get(market_id), market_total_yes_supply.get(market_id));
            assert_eq(market_total_yes_supply.get(market_id), market_total_no_supply.get(market_id));

            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);

            let yes_amount_async: u128 = net;
            let yes_effective_async: u128 = (yes_amount_async * (FEE_SCALE as u128 - fee_bps as u128)) / FEE_SCALE as u128;
            let no_out_async: u128 = (yes_effective_async * no_reserve) / (yes_reserve + yes_effective_async);
            let yes_reserve_new_async: u128 = yes_reserve + yes_amount_async;
            let no_reserve_new_async: u128 = no_reserve - no_out_async;

            market_yes_reserve.set(market_id, yes_reserve_new_async);
            market_no_reserve.set(market_id, no_reserve_new_async);

            position_yes_shares.set(pos_key, new_yes);
            position_no_shares.set(pos_key, new_no);
            position_collateral_committed.set(pos_key, new_committed);
            position_payout_claimed.set(pos_key, existing_payout_claimed);

            let price_yes_val: u128 = (no_reserve_new_async * SCALE as u128) / (yes_reserve_new_async + no_reserve_new_async);
            assert(price_yes_val <= MAX_U64);
            let price_yes: u64 = price_yes_val as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    async transition swap_yes_no_private(
        market_id: field,
        existing_position: Position,
        yes_amount: u128,
        min_no_out: u128,
        yes_reserve: u128,
        no_reserve: u128,
        fee_bps: u64,
        status_hint: u8
    ) -> (Position, Future) {
        assert_eq(existing_position.owner, self.signer);
        assert(!existing_position.payout_claimed);
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let caller_f: field = caller as field;
        let existing_market_id: field = existing_position.market_id;

        assert(yes_amount > 0u128);
        assert_eq(existing_market_id, market_id);
        assert(existing_yes_shares >= yes_amount);
        assert(min_no_out <= MAX_POOL);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(fee_bps <= FEE_SCALE);
        assert(status_hint == STATUS_OPEN);
        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);
        assert(yes_reserve <= MAX_POOL);
        assert(no_reserve <= MAX_POOL);
        assert(yes_amount <= MAX_POOL);
        assert(yes_reserve <= MAX_POOL - yes_amount);

        let yes_effective: u128 = (yes_amount * (FEE_SCALE as u128 - fee_bps as u128)) / FEE_SCALE as u128;
        assert(yes_effective <= MAX_POOL);
        assert(yes_effective > 0u128);

        let no_out: u128 = (yes_effective * no_reserve) / (yes_reserve + yes_effective);
        assert(no_out <= MAX_POOL);
        assert(no_out >= min_no_out);
        assert(no_reserve >= no_out);

        let yes_reserve_new: u128 = yes_reserve + yes_amount;
        let no_reserve_new: u128 = no_reserve - no_out;
        assert(yes_reserve_new <= MAX_POOL);
        assert(no_reserve_new <= MAX_POOL);

        assert(existing_no_shares <= MAX_POOL - no_out);
        let new_no: u128 = existing_no_shares + no_out;

        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + caller_f);

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: existing_yes_shares - yes_amount,
            no_shares: new_no,
            collateral_committed: existing_committed,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);
            assert_eq(market_fee_bps.get(market_id), fee_bps);

            assert(position_exists.contains(pos_key));
            let on_chain_yes: u128 = position_yes_shares.get(pos_key);
            let on_chain_no: u128 = position_no_shares.get(pos_key);
            let on_chain_committed: u128 = position_collateral_committed.get(pos_key);
            let on_chain_claimed: bool = position_payout_claimed.get(pos_key);
            assert_eq(on_chain_yes, existing_yes_shares);
            assert_eq(on_chain_no, existing_no_shares);
            assert_eq(on_chain_committed, existing_committed);
            assert_eq(on_chain_claimed, existing_payout_claimed);

            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);

            market_yes_reserve.set(market_id, yes_reserve_new);
            market_no_reserve.set(market_id, no_reserve_new);

            position_yes_shares.set(pos_key, existing_yes_shares - yes_amount);
            position_no_shares.set(pos_key, new_no);
            position_collateral_committed.set(pos_key, existing_committed);
            position_payout_claimed.set(pos_key, existing_payout_claimed);

            // Swaps conserve shares globally; total supply unchanged (no supply mappings updated here).
            let price_yes_val: u128 = (no_reserve_new * SCALE as u128) / (yes_reserve_new + no_reserve_new);
            assert(price_yes_val <= MAX_U64);
            let price_yes: u64 = price_yes_val as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    async transition swap_no_yes_private(
        market_id: field,
        existing_position: Position,
        no_amount: u128,
        min_yes_out: u128,
        yes_reserve: u128,
        no_reserve: u128,
        fee_bps: u64,
        status_hint: u8
    ) -> (Position, Future) {
        assert_eq(existing_position.owner, self.signer);
        assert(!existing_position.payout_claimed);
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let caller_f: field = caller as field;
        let existing_market_id: field = existing_position.market_id;

        assert(no_amount > 0u128);
        assert_eq(existing_market_id, market_id);
        assert(existing_no_shares >= no_amount);
        assert(min_yes_out <= MAX_POOL);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(fee_bps <= FEE_SCALE);
        assert(status_hint == STATUS_OPEN);
        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);
        assert(yes_reserve <= MAX_POOL);
        assert(no_reserve <= MAX_POOL);
        assert(no_amount <= MAX_POOL);
        assert(no_reserve <= MAX_POOL - no_amount);

        let no_effective: u128 = (no_amount * (FEE_SCALE as u128 - fee_bps as u128)) / FEE_SCALE as u128;
        assert(no_effective <= MAX_POOL);
        assert(no_effective > 0u128);

        let yes_out: u128 = (no_effective * yes_reserve) / (no_reserve + no_effective);
        assert(yes_out <= MAX_POOL);
        assert(yes_out >= min_yes_out);
        assert(yes_reserve >= yes_out);

        let no_reserve_new: u128 = no_reserve + no_amount;
        let yes_reserve_new: u128 = yes_reserve - yes_out;
        assert(no_reserve_new <= MAX_POOL);
        assert(yes_reserve_new <= MAX_POOL);

        assert(existing_yes_shares <= MAX_POOL - yes_out);
        let new_yes: u128 = existing_yes_shares + yes_out;

        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + caller_f);

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: new_yes,
            no_shares: existing_no_shares - no_amount,
            collateral_committed: existing_committed,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);
            assert_eq(market_fee_bps.get(market_id), fee_bps);

            assert(position_exists.contains(pos_key));
            let on_chain_yes: u128 = position_yes_shares.get(pos_key);
            let on_chain_no: u128 = position_no_shares.get(pos_key);
            let on_chain_committed: u128 = position_collateral_committed.get(pos_key);
            let on_chain_claimed: bool = position_payout_claimed.get(pos_key);
            assert_eq(on_chain_yes, existing_yes_shares);
            assert_eq(on_chain_no, existing_no_shares);
            assert_eq(on_chain_committed, existing_committed);
            assert_eq(on_chain_claimed, existing_payout_claimed);

            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);

            market_yes_reserve.set(market_id, yes_reserve_new);
            market_no_reserve.set(market_id, no_reserve_new);

            position_yes_shares.set(pos_key, new_yes);
            position_no_shares.set(pos_key, existing_no_shares - no_amount);
            position_collateral_committed.set(pos_key, existing_committed);
            position_payout_claimed.set(pos_key, existing_payout_claimed);

            // Swaps conserve shares globally; total supply unchanged (no supply mappings updated here).
            let price_yes_val: u128 = (no_reserve_new * SCALE as u128) / (yes_reserve_new + no_reserve_new);
            assert(price_yes_val <= MAX_U64);
            let price_yes: u64 = price_yes_val as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    async transition merge_tokens_private(
        market_id: field,
        existing_position: Position,
        merge_amount: u128,
        min_collateral_out: u64
    ) -> (Position, Future) {
        assert_eq(existing_position.owner, self.signer); // bind Position to caller
        assert(!existing_position.payout_claimed); // disallow using claimed positions in swaps/merge
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let caller_f: field = caller as field;
        let existing_market_id: field = existing_position.market_id;

        assert(merge_amount > 0u128);
        assert_eq(existing_market_id, market_id);
        assert(existing_yes_shares >= merge_amount);
        assert(existing_no_shares >= merge_amount);
        assert(merge_amount <= MAX_POOL);

        // Compute position key and validate against on-chain state (unified: caller_f from existing_position.owner)
        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + caller_f);

        let collateral_out: u128 = merge_amount;
        assert(collateral_out <= MAX_U64);
        let collateral_out_u64: u64 = collateral_out as u64;

        assert(collateral_out_u64 >= min_collateral_out);
        assert(existing_committed >= collateral_out);

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: existing_yes_shares - merge_amount,
            no_shares: existing_no_shares - merge_amount,
            collateral_committed: existing_committed - collateral_out,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);

            // Validate and update on-chain position state
            assert(position_exists.contains(pos_key));
            let on_chain_yes: u128 = position_yes_shares.get(pos_key);
            let on_chain_no: u128 = position_no_shares.get(pos_key);
            let on_chain_committed: u128 = position_collateral_committed.get(pos_key);
            let on_chain_claimed: bool = position_payout_claimed.get(pos_key);
            
            // Validate input Position matches on-chain state (prevents replay/fork)
            assert_eq(on_chain_yes, existing_yes_shares);
            assert_eq(on_chain_no, existing_no_shares);
            assert_eq(on_chain_committed, existing_committed);
            assert_eq(on_chain_claimed, existing_payout_claimed);

            // Debit pool before crediting user (solvency: never credit if pool debit could fail)
            assert(market_collateral_pool.contains(market_id));
            let current_pool: u128 = market_collateral_pool.get(market_id);
            assert(current_pool >= collateral_out);
            market_collateral_pool.set(market_id, current_pool - collateral_out);

            // Merge does not change reserves (user shares are not in the AMM pool)
            let curr_total_yes: u128 = market_total_yes_supply.get(market_id);
            let curr_total_no: u128 = market_total_no_supply.get(market_id);
            assert(curr_total_yes >= merge_amount);
            assert(curr_total_no >= merge_amount);
            market_total_yes_supply.set(market_id, curr_total_yes - merge_amount);
            market_total_no_supply.set(market_id, curr_total_no - merge_amount);

            assert_eq(market_collateral_pool.get(market_id), market_total_yes_supply.get(market_id));
            assert_eq(market_total_yes_supply.get(market_id), market_total_no_supply.get(market_id));

            if user_collateral.contains(caller_f) {
                let current: u128 = user_collateral.get(caller_f);
                assert(current <= MAX_POOL - collateral_out);
                user_collateral.set(caller_f, current + collateral_out);
            } else {
                user_collateral.set(caller_f, collateral_out);
            }

            // Update on-chain position state
            position_yes_shares.set(pos_key, existing_yes_shares - merge_amount);
            position_no_shares.set(pos_key, existing_no_shares - merge_amount);
            position_collateral_committed.set(pos_key, existing_committed - collateral_out);
            position_payout_claimed.set(pos_key, existing_payout_claimed);

            let curr_yes: u128 = market_yes_reserve.get(market_id);
            let curr_no: u128 = market_no_reserve.get(market_id);
            let price_yes_val: u128 = (curr_no * SCALE as u128) / (curr_yes + curr_no);
            assert(price_yes_val <= MAX_U64);
            let price_yes: u64 = price_yes_val as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    async transition resolve(
        market_id: field,
        outcome: bool
    ) -> Future {
        assert_eq(self.signer, ADMIN);

        return async {
            assert(market_status.contains(market_id));
            let status: u8 = market_status.get(market_id);
            assert_eq(status, STATUS_OPEN);

            // Option A settlement: burn reserve inventory so pool backs only user winning supply; excess = former winning reserve.
            assert(market_collateral_pool.contains(market_id));
            assert(market_yes_reserve.contains(market_id));
            assert(market_no_reserve.contains(market_id));
            assert(market_total_yes_supply.contains(market_id));
            assert(market_total_no_supply.contains(market_id));
            let pool: u128 = market_collateral_pool.get(market_id);
            let yes_reserve: u128 = market_yes_reserve.get(market_id);
            let no_reserve: u128 = market_no_reserve.get(market_id);
            let total_yes: u128 = market_total_yes_supply.get(market_id);
            let total_no: u128 = market_total_no_supply.get(market_id);
            assert_eq(pool, total_yes);
            assert_eq(pool, total_no);
            assert(total_yes >= yes_reserve);
            assert(total_no >= no_reserve);

            let winning_reserve: u128 = outcome ? yes_reserve : no_reserve;
            let winning_supply_after: u128 = outcome ? (total_yes - yes_reserve) : (total_no - no_reserve);
            assert(pool >= winning_supply_after);
            assert(pool - winning_supply_after == winning_reserve);

            market_total_yes_supply.set(market_id, total_yes - yes_reserve);
            market_total_no_supply.set(market_id, total_no - no_reserve);
            market_yes_reserve.set(market_id, 0u128);
            market_no_reserve.set(market_id, 0u128);

            assert_eq(market_yes_reserve.get(market_id), 0u128);
            assert_eq(market_no_reserve.get(market_id), 0u128);
            assert_eq(market_total_yes_supply.get(market_id), total_yes - yes_reserve);
            assert_eq(market_total_no_supply.get(market_id), total_no - no_reserve);

            market_outcome.set(market_id, outcome);
            market_status.set(market_id, STATUS_RESOLVED);

            last_resolve.set(market_id, outcome);
        };
    }

    async transition pause(market_id: field) -> Future {
        assert_eq(self.signer, ADMIN);

        return async {
            assert(market_status.contains(market_id));
            let status: u8 = market_status.get(market_id);
            assert_eq(status, STATUS_OPEN);

            market_status.set(market_id, STATUS_PAUSED);
        };
    }

    async transition unpause(market_id: field) -> Future {
        assert_eq(self.signer, ADMIN);

        return async {
            assert(market_status.contains(market_id));
            let status: u8 = market_status.get(market_id);
            assert_eq(status, STATUS_PAUSED);

            market_status.set(market_id, STATUS_OPEN);
        };
    }

    // Withdraws from market_fee_collected only (collateral from mint fees).
    // Swap fees are in shares and remain in the pool; they are not in market_fee_collected.
    // Transition commits only if the full async block succeeds; state is debited before transfer await.
    async transition withdraw_fees_private(
        market_id: field,
        amount: u64
    ) -> (credits.aleo/credits, Future) {
        assert(amount > 0u64);
        let caller: address = self.signer;

        let result = credits.aleo/transfer_public_to_private(self.signer, amount);

        return (result.0, async {
            // All authorization and state checks and debit run before await; transfer settles only if checks pass.
            assert(market_creator.contains(market_id));
            assert_eq(caller, market_creator.get(market_id));
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_RESOLVED);

            assert(market_fee_collected.contains(market_id));
            let fees: u128 = market_fee_collected.get(market_id);
            assert(fees >= amount as u128);

            let new_fees: u128 = fees - amount as u128;
            market_fee_collected.set(market_id, new_fees);

            result.1.await();
        });
    }

    // Creator withdraws own liquidity bucket (market_creator_liquidity). RESOLVED only; does not affect pool.
    async transition withdraw_creator_liq_private(
        market_id: field,
        amount: u64
    ) -> (credits.aleo/credits, Future) {
        assert(amount > 0u64);
        let caller: address = self.signer;

        let result = credits.aleo/transfer_public_to_private(self.signer, amount);

        return (result.0, async {
            // All authorization and state checks and debit run before await; transfer settles only if checks pass.
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_RESOLVED);
            assert(market_creator.contains(market_id));
            assert_eq(caller, market_creator.get(market_id));
            assert(market_creator_liquidity.contains(market_id));
            let balance: u128 = market_creator_liquidity.get(market_id);
            assert(balance >= amount as u128);
            market_creator_liquidity.set(market_id, balance - amount as u128);
            result.1.await();
        });
    }

    // Creator withdraws rare accidental surplus (pool - remaining_winning_supply). Does not touch market_creator_liquidity.
    async transition withdraw_excess_private(
        market_id: field,
        amount: u64
    ) -> (credits.aleo/credits, Future) {
        assert(amount > 0u64);
        let caller: address = self.signer;

        let result = credits.aleo/transfer_public_to_private(self.signer, amount);

        return (result.0, async {
            // All authorization and state checks and debit run before await; transfer settles only if checks pass.
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_RESOLVED);
            assert(market_creator.contains(market_id));
            assert_eq(caller, market_creator.get(market_id));
            assert(market_outcome.contains(market_id));
            assert(market_collateral_pool.contains(market_id));
            assert(market_yes_reserve.contains(market_id));
            assert(market_no_reserve.contains(market_id));
            assert_eq(market_yes_reserve.get(market_id), 0u128);
            assert_eq(market_no_reserve.get(market_id), 0u128);

            let pool: u128 = market_collateral_pool.get(market_id);
            let outcome: bool = market_outcome.get(market_id);

            let winning_supply: u128 = outcome ? market_total_yes_supply.get(market_id) : market_total_no_supply.get(market_id);
            assert(pool >= winning_supply);
            let excess: u128 = pool - winning_supply;
            assert(amount as u128 <= excess);

            market_collateral_pool.set(market_id, pool - amount as u128);
            result.1.await();
        });
    }

    // Post-resolution only: redeem winning shares 1:1 from pool; only winning supply decremented.
    async transition redeem_private(
        market_id: field,
        existing_position: Position,
        outcome: bool
    ) -> (Position, credits.aleo/credits, Future) {
        assert_eq(existing_position.owner, self.signer);
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let caller_f: field = caller as field;
        let existing_market_id: field = existing_position.market_id;

        let pos_key: field = BHP256::hash_to_field(10field + market_id + 11field + caller_f);

        assert(!existing_payout_claimed);

        // Payout is strictly winning_shares 1:1 (no cap from collateral_committed)
        let winning_shares: u128 = outcome ? existing_yes_shares : existing_no_shares;
        assert(winning_shares > 0u128);
        assert(winning_shares <= MAX_U64);
        let payout: u64 = winning_shares as u64;

        let result = credits.aleo/transfer_public_to_private(caller, payout);
        let credit_record = result.0;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: 0u128,
            no_shares: 0u128,
            collateral_committed: 0u128,
            payout_claimed: true
        };

        return (updated_position, credit_record, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_RESOLVED);
            assert(market_outcome.contains(market_id));
            let outcome_from_mapping: bool = market_outcome.get(market_id);
            assert_eq(outcome_from_mapping, outcome);

            assert_eq(market_yes_reserve.get(market_id), 0u128);
            assert_eq(market_no_reserve.get(market_id), 0u128);

            assert(position_exists.contains(pos_key));
            let on_chain_yes: u128 = position_yes_shares.get(pos_key);
            let on_chain_no: u128 = position_no_shares.get(pos_key);
            let on_chain_committed: u128 = position_collateral_committed.get(pos_key);
            let on_chain_claimed: bool = position_payout_claimed.get(pos_key);
            assert_eq(on_chain_yes, existing_yes_shares);
            assert_eq(on_chain_no, existing_no_shares);
            assert_eq(on_chain_committed, existing_committed);
            assert_eq(on_chain_claimed, existing_payout_claimed);
            assert(!on_chain_claimed);
            assert_eq(existing_market_id, market_id);

            // Debit pool and supply before transfer await to enforce solvency.
            assert(market_collateral_pool.contains(market_id));
            let current_pool: u128 = market_collateral_pool.get(market_id);
            // Post-resolution solvency: pool must be at least remaining winning supply.
            if outcome {
                let winning_supply_pre: u128 = market_total_yes_supply.get(market_id);
                assert(current_pool >= winning_supply_pre);
            } else {
                let winning_supply_pre: u128 = market_total_no_supply.get(market_id);
                assert(current_pool >= winning_supply_pre);
            }
            assert(current_pool >= payout as u128);
            market_collateral_pool.set(market_id, current_pool - payout as u128);

            position_yes_shares.set(pos_key, 0u128);
            position_no_shares.set(pos_key, 0u128);
            position_collateral_committed.set(pos_key, 0u128);
            position_payout_claimed.set(pos_key, true);

            if outcome {
                let curr_total_yes: u128 = market_total_yes_supply.get(market_id);
                assert(curr_total_yes >= winning_shares);
                market_total_yes_supply.set(market_id, curr_total_yes - winning_shares);
            } else {
                let curr_total_no: u128 = market_total_no_supply.get(market_id);
                assert(curr_total_no >= winning_shares);
                market_total_no_supply.set(market_id, curr_total_no - winning_shares);
            }
            // Post-resolution solvency: after redeem, pool >= remaining winning supply.
            let updated_pool: u128 = market_collateral_pool.get(market_id);
            if outcome {
                let updated_yes: u128 = market_total_yes_supply.get(market_id);
                assert(updated_pool >= updated_yes);
            } else {
                let updated_no: u128 = market_total_no_supply.get(market_id);
                assert(updated_pool >= updated_no);
            }

            result.1.await();
        });
    }
}
