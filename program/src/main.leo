import credits.aleo;

program prediction_market_testing_v3.aleo {
    // Constants
    const ADMIN: address = aleo1xh0ncflwkfzga983lwujsha729c8nwu7phfn8aw7h3gahhj0ms8qytrxec; // Admin address
    const SCALE: u64 = 10000u64; // Price scale (basis points)
    const MAX_COLLATERAL: u64 = 1000000000000u64; // 1 trillion (practical limit)
    const STATUS_OPEN: u8 = 0u8;
    const STATUS_RESOLVED: u8 = 1u8;
    const STATUS_PAUSED: u8 = 2u8;

    // AMM Constants
    const FEE_SCALE: u64 = 10000u64; // Basis points scale (reuse existing SCALE)
    const MIN_LIQUIDITY: u128 = 1000u128; // Minimum liquidity to prevent division by zero and ensure market exists
    const MAX_FEE_BPS: u64 = 1000u64; // Maximum 10% fee (safety limit)

    // Market state
    mapping market_status: field => u8; // 0=open, 1=resolved, 2=paused
    mapping market_outcome: field => bool; // true=YES, false=NO
    mapping market_collateral_pool: field => u128; // Total collateral (aggregate only)
    mapping market_creator: field => address; // Creator address for each market
    mapping market_metadata_hash: field => field; // Metadata hash for indexers
    mapping market_bond: field => u128; // Creation bond (non-redeemable, tracked separately from pool)

    // AMM State
    mapping market_yes_reserve: field => u128; // YES token reserve
    mapping market_no_reserve: field => u128; // NO token reserve
    mapping market_fee_bps: field => u64; // fee bps
    mapping market_fee_collected: field => u128; // protocol fees collected
    mapping market_initial_liquidity: field => u128; // initial liquidity deposit

    // Market enumeration
    mapping market_index: u64 => field; // Index => market_id
    mapping total_markets: u64 => u64;  // total_markets[0] = count

    record Position {
        owner: address,
        market_id: field,
        yes_shares: u128,
        no_shares: u128,
        collateral_available: u128,
        collateral_committed: u128,
        payout_claimed: bool
    }

    mapping last_price_update: field => u64;
    mapping last_resolve: field => bool;

    @admin(address="aleo1xh0ncflwkfzga983lwujsha729c8nwu7phfn8aw7h3gahhj0ms8qytrxec")
    async constructor() {
    }

    async transition init(
        initial_liquidity: u64,
        bond_amount: u64,
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

        let total_transfer: u64 = bond_amount + initial_liquidity;
        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, total_transfer);
        let change_record = result.0;

        let creator: address = self.signer;

        return (change_record, async {
            result.1.await();

            let creator_f: field = creator as field;
            let preimage: field = creator_f + metadata_hash + salt + 1field;
            let market_id: field = BHP256::hash_to_field(preimage);

            assert(!market_status.contains(market_id));
            assert(!market_creator.contains(market_id));
            assert(!market_metadata_hash.contains(market_id));
            assert(!market_bond.contains(market_id));

            let initial_liquidity_u128: u128 = initial_liquidity as u128;
            market_status.set(market_id, STATUS_OPEN);
            market_collateral_pool.set(market_id, initial_liquidity_u128);
            market_yes_reserve.set(market_id, initial_liquidity_u128);
            market_no_reserve.set(market_id, initial_liquidity_u128);
            market_fee_bps.set(market_id, fee_bps);
            market_initial_liquidity.set(market_id, initial_liquidity_u128);
            market_creator.set(market_id, creator);
            market_metadata_hash.set(market_id, metadata_hash);
            market_bond.set(market_id, bond_amount as u128);
            last_price_update.set(market_id, SCALE / 2u64);

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
        credit_record: credits.aleo/credits,
        amount: u64,
        status_hint: u8
    ) -> (Position, credits.aleo/credits, Future) {
        assert(amount > 0u64);
        assert(amount <= MAX_COLLATERAL);
        assert(status_hint == STATUS_OPEN);

        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, amount);
        let change_record = result.0;

        let updated_position = Position {
            owner: self.signer,
            market_id: market_id,
            yes_shares: 0u128,
            no_shares: 0u128,
            collateral_available: amount as u128,
            collateral_committed: 0u128,
            payout_claimed: false
        };

        return (updated_position, change_record, async {
            result.1.await();

            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);

            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                market_collateral_pool.set(market_id, current_pool + amount as u128);
            } else {
                market_collateral_pool.set(market_id, amount as u128);
            }
        });
    }

    async transition deposit_private(
        market_id: field,
        credit_record: credits.aleo/credits,
        amount: u64,
        existing_position: Position,
        status_hint: u8
    ) -> (Position, credits.aleo/credits, Future) {
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_available: u128 = existing_position.collateral_available;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let existing_market_id: field = existing_position.market_id;

        assert(amount > 0u64);
        assert(amount <= MAX_COLLATERAL);
        assert_eq(existing_market_id, market_id);
        assert(status_hint == STATUS_OPEN);

        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, amount);
        let change_record = result.0;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: existing_yes_shares,
            no_shares: existing_no_shares,
            collateral_available: existing_available + amount as u128,
            collateral_committed: existing_committed,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, change_record, async {
            result.1.await();

            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);

            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                market_collateral_pool.set(market_id, current_pool + amount as u128);
            } else {
                market_collateral_pool.set(market_id, amount as u128);
            }
        });
    }

    async transition swap_collateral_for_yes_private(
        market_id: field,
        existing_position: Position,
        collateral_in: u64,
        min_yes_out: u128,
        yes_reserve: u128,
        no_reserve: u128,
        fee_bps: u64,
        status_hint: u8
    ) -> (Position, Future) {
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_available: u128 = existing_position.collateral_available;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let existing_market_id: field = existing_position.market_id;

        assert(collateral_in > 0u64);
        assert_eq(existing_market_id, market_id);
        assert(collateral_in as u128 <= existing_available);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(status_hint == STATUS_OPEN);

        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);

        let collateral_in_u128: u128 = collateral_in as u128;

        let minted_yes: u128 = collateral_in_u128;
        let minted_no: u128 = collateral_in_u128;

        let fee: u128 = (minted_no * fee_bps as u128) / FEE_SCALE as u128;
        let no_after_fee: u128 = minted_no - fee;

        let yes_out: u128 = (no_after_fee * yes_reserve) / (no_reserve + no_after_fee);
        let total_yes_for_user: u128 = minted_yes + yes_out;

        assert(total_yes_for_user >= min_yes_out);
        assert(yes_reserve >= yes_out);

        let yes_reserve_new: u128 = yes_reserve - yes_out;
        let no_reserve_new: u128 = no_reserve + minted_no;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: existing_yes_shares + total_yes_for_user,
            no_shares: existing_no_shares,
            collateral_available: existing_available - collateral_in as u128,
            collateral_committed: existing_committed + collateral_in as u128,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);

            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);
            assert_eq(market_fee_bps.get(market_id), fee_bps);

            market_yes_reserve.set(market_id, yes_reserve_new);
            market_no_reserve.set(market_id, no_reserve_new);

            if market_fee_collected.contains(market_id) {
                let current_fees: u128 = market_fee_collected.get(market_id);
                market_fee_collected.set(market_id, current_fees + fee);
            } else {
                market_fee_collected.set(market_id, fee);
            }

            let price_yes: u64 = ((no_reserve_new * SCALE as u128) / (yes_reserve_new + no_reserve_new)) as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    async transition swap_collateral_for_no_private(
        market_id: field,
        existing_position: Position,
        collateral_in: u64,
        min_no_out: u128,
        yes_reserve: u128,
        no_reserve: u128,
        fee_bps: u64,
        status_hint: u8
    ) -> (Position, Future) {
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_available: u128 = existing_position.collateral_available;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let existing_market_id: field = existing_position.market_id;

        assert(collateral_in > 0u64);
        assert(collateral_in <= MAX_COLLATERAL);
        assert_eq(existing_market_id, market_id);
        assert(collateral_in as u128 <= existing_available);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(status_hint == STATUS_OPEN);

        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);

        let collateral_in_u128: u128 = collateral_in as u128;

        let minted_yes: u128 = collateral_in_u128;
        let minted_no: u128 = collateral_in_u128;

        let fee: u128 = (minted_yes * fee_bps as u128) / FEE_SCALE as u128;
        let yes_after_fee: u128 = minted_yes - fee;

        let no_out: u128 = (yes_after_fee * no_reserve) / (yes_reserve + yes_after_fee);
        let total_no_for_user: u128 = minted_no + no_out;

        assert(total_no_for_user >= min_no_out);
        assert(no_reserve >= no_out);

        let no_reserve_new: u128 = no_reserve - no_out;
        let yes_reserve_new: u128 = yes_reserve + minted_yes;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: existing_yes_shares,
            no_shares: existing_no_shares + total_no_for_user,
            collateral_available: existing_available - collateral_in as u128,
            collateral_committed: existing_committed + collateral_in as u128,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, async {
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);

            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);
            assert_eq(market_fee_bps.get(market_id), fee_bps);

            market_yes_reserve.set(market_id, yes_reserve_new);
            market_no_reserve.set(market_id, no_reserve_new);

            if market_fee_collected.contains(market_id) {
                let current_fees: u128 = market_fee_collected.get(market_id);
                market_fee_collected.set(market_id, current_fees + fee);
            } else {
                market_fee_collected.set(market_id, fee);
            }

            let price_yes: u64 = ((no_reserve_new * SCALE as u128) / (yes_reserve_new + no_reserve_new)) as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    async transition merge_tokens_private(
        market_id: field,
        existing_position: Position,
        merge_amount: u128,
        min_collateral_out: u64
    ) -> (Position, credits.aleo/credits, Future) {
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_available: u128 = existing_position.collateral_available;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let existing_market_id: field = existing_position.market_id;

        assert(merge_amount > 0u128);
        assert_eq(existing_market_id, market_id);
        assert(existing_yes_shares >= merge_amount);
        assert(existing_no_shares >= merge_amount);

        let collateral_out: u128 = merge_amount;
        let collateral_out_u64: u64 = collateral_out as u64;

        assert(collateral_out_u64 >= min_collateral_out);
        assert(existing_committed >= collateral_out);

        let result = credits.aleo/transfer_public_to_private(caller, collateral_out_u64);
        let credit_record = result.0;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: existing_yes_shares - merge_amount,
            no_shares: existing_no_shares - merge_amount,
            collateral_available: existing_available,
            collateral_committed: existing_committed - collateral_out,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, credit_record, async {
            result.1.await();

            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);

            // current_pool read without ternary-get
            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                assert(current_pool >= collateral_out);
                market_collateral_pool.set(market_id, current_pool - collateral_out);
            } else {
                // should never happen if market exists; keep explicit failure semantics
                assert(false);
            }

            let current_yes_reserve: u128 = market_yes_reserve.get(market_id);
            let current_no_reserve: u128 = market_no_reserve.get(market_id);
            let price_yes: u64 = ((current_no_reserve * SCALE as u128) / (current_yes_reserve + current_no_reserve)) as u64;
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

    async transition withdraw_private(
        market_id: field,
        existing_position: Position,
        amount: u64
    ) -> (Position, credits.aleo/credits, Future) {
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_available: u128 = existing_position.collateral_available;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let existing_market_id: field = existing_position.market_id;

        assert(existing_yes_shares == 0u128);
        assert(existing_no_shares == 0u128);
        assert(existing_committed == 0u128);
        assert(amount > 0u64);
        assert(amount as u128 <= existing_available);

        let result = credits.aleo/transfer_public_to_private(caller, amount);
        let credit_record = result.0;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: existing_yes_shares,
            no_shares: existing_no_shares,
            collateral_available: existing_available - amount as u128,
            collateral_committed: existing_committed,
            payout_claimed: existing_payout_claimed
        };

        return (updated_position, credit_record, async {
            result.1.await();

            assert(market_status.contains(market_id));
            let status: u8 = market_status.get(market_id);
            assert(status == STATUS_OPEN || status == STATUS_RESOLVED);
            assert_eq(existing_market_id, market_id);

            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                assert(current_pool >= amount as u128);
                market_collateral_pool.set(market_id, current_pool - amount as u128);
            } else {
                assert(false);
            }
        });
    }

    async transition redeem_private(
        market_id: field,
        existing_position: Position,
        outcome: bool
    ) -> (Position, credits.aleo/credits, Future) {
        let existing_yes_shares: u128 = existing_position.yes_shares;
        let existing_no_shares: u128 = existing_position.no_shares;
        let existing_available: u128 = existing_position.collateral_available;
        let existing_committed: u128 = existing_position.collateral_committed;
        let existing_payout_claimed: bool = existing_position.payout_claimed;
        let caller: address = existing_position.owner;
        let existing_market_id: field = existing_position.market_id;

        assert(!existing_payout_claimed);

        let winning_shares: u128 = outcome ? existing_yes_shares : existing_no_shares;
        assert(winning_shares > 0u128);

        assert(winning_shares <= 18446744073709551615u128);
        let payout: u64 = winning_shares as u64;

        assert(existing_committed >= payout as u128);

        let result = credits.aleo/transfer_public_to_private(caller, payout);
        let credit_record = result.0;

        let updated_position = Position {
            owner: caller,
            market_id: market_id,
            yes_shares: 0u128,
            no_shares: 0u128,
            collateral_available: existing_available,
            collateral_committed: existing_committed - payout as u128,
            payout_claimed: true
        };

        return (updated_position, credit_record, async {
            result.1.await();

            assert(!existing_payout_claimed);
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_RESOLVED);
            assert_eq(existing_market_id, market_id);
            assert(market_outcome.contains(market_id));

            let outcome_from_mapping: bool = market_outcome.get(market_id);
            assert_eq(outcome_from_mapping, outcome);

            if market_collateral_pool.contains(market_id) {
                let current_pool: u128 = market_collateral_pool.get(market_id);
                assert(current_pool >= payout as u128);
                market_collateral_pool.set(market_id, current_pool - payout as u128);
            } else {
                assert(false);
            }
        });
    }
}
