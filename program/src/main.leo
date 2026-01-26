import credits.aleo;

program prediction_market_testing.aleo {
    // Constants
    const ADMIN: address = aleo17hqgrmy5nk5s7adxhckhsk0k23r7e343ddcnnx49r59lx64thq9q302526; // Admin address
    const SCALE: u64 = 10000u64; // Price scale (basis points)
    const MAX_COLLATERAL: u64 = 1000000000000u64; // 1 trillion (practical limit)
    const STATUS_OPEN: u8 = 0u8;
    const STATUS_RESOLVED: u8 = 1u8;
    const STATUS_PAUSED: u8 = 2u8;
    
    // AMM Constants
    const FEE_SCALE: u64 = 10000u64; // Basis points scale (reuse existing SCALE)
    const MIN_LIQUIDITY: u128 = 1000u128; // Minimum liquidity to prevent division by zero and ensure market exists
    const MAX_FEE_BPS: u64 = 1000u64; // Maximum 10% fee (safety limit)
    
    // Market ID generation
    mapping market_id_counter: address => u64; // Counter per creator for unique market IDs
    
    // Market state (using field-based market_id as identifier)
    mapping market_status: field => u8; // 0=open, 1=resolved, 2=paused
    mapping market_outcome: field => bool; // true=YES, false=NO
    // mapping market_price_yes: field => u64; // REMOVED: price now derived from AMM reserves
    mapping market_collateral_pool: field => u128; // Total collateral (aggregate only)
    mapping market_creator: field => address; // Creator address for each market
    mapping market_metadata_hash: field => field; // Metadata hash for indexers
    mapping market_bond: field => u128; // Creation bond (non-redeemable, tracked separately from pool)
    
    // AMM State
    mapping market_yes_reserve: field => u128; // YES token reserve (shares in AMM pool)
    mapping market_no_reserve: field => u128; // NO token reserve (shares in AMM pool)
    mapping market_fee_bps: field => u64; // Fee in basis points (e.g., 30 = 0.3%, stored per-market for flexibility)
    mapping market_fee_collected: field => u128; // Protocol fees collected (separate from collateral pool to preserve solvency)
    mapping market_initial_liquidity: field => u128; // Track initial liquidity deposit (for potential liquidity provider rewards or migration)
    
    // Global totals removed for MVP safety - not consistent with mint+reserve behavior
    
    // Position record structure - users hold these privately (encrypted)
    // All user data is stored in private records, not public mappings
    // Collateral is tracked per-user in Position record to prevent unauthorized withdrawals
    record Position {
        owner: address,
        market_id: field,
        yes_shares: u128,
        no_shares: u128,
        collateral_available: u128,   // user escrow not yet committed; can be used for swaps and withdrawn when no shares
        collateral_committed: u128,   // collateral backing minted shares; can be paid out via merge/redeem only
        payout_claimed: bool          // prevents double redemption; does not block deposits/swaps/merge
    }
    
    // Output mappings for indexing (tuples not supported as mapping values in Leo)
    mapping last_price_update: field => u64; // new price
    mapping last_resolve: field => bool; // outcome

    @admin(address="aleo17hqgrmy5nk5s7adxhckhsk0k23r7e343ddcnnx49r59lx64thq9q302526")
    async constructor() {
        // NOTE: @admin constructors must be empty - Leo compiler automatically generates constructor logic.
        // Admin address is configured via the @admin annotation above.
        // For upgrade safety, admin is defined as a constant (ADMIN) and verified using self.signer in admin functions.
    }

    // Market Initialization
    async transition init(
        initial_liquidity: u64,
        bond_amount: u64,
        fee_bps: u64,
        metadata_hash: field,
        credit_record: credits.aleo/credits
    ) -> (credits.aleo/credits, Future) {
        // Validate AMM parameters before transfer
        assert(initial_liquidity >= MIN_LIQUIDITY as u64);
        assert(fee_bps <= MAX_FEE_BPS);
        assert(bond_amount > 0u64);
        
        // CRITICAL: Overflow protection and MAX_COLLATERAL enforcement
        assert(bond_amount <= MAX_COLLATERAL);
        assert(initial_liquidity <= MAX_COLLATERAL);
        // Check overflow: ensure bond_amount + initial_liquidity doesn't exceed MAX_COLLATERAL
        assert(bond_amount <= MAX_COLLATERAL - initial_liquidity);
        
        // Transfer creation bond + initial liquidity before setting market state
        // NOTE: Mapping reads must be in async blocks, but execution is atomic.
        // If validations in the async block fail, the entire transaction (including transfer) will revert.
        // This ensures we don't have "paid then failed" scenarios despite the transfer-first pattern.
        let total_transfer: u64 = bond_amount + initial_liquidity;
        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, total_transfer);
        let change_record = result.0;
        
        // Capture signer before async block (self.signer cannot be used directly in async blocks)
        let creator: address = self.signer;
        
        return (change_record, async {
            result.1.await();
            // Generate unique market ID using domain-separated hash to avoid algebraic collision structure
            // Use double hashing for collision resistance with simpler structure
            let counter: u64 = market_id_counter.contains(creator) ? market_id_counter.get(creator) : 0u64;
            let caller_field: field = creator as field;
            let counter_field: field = counter as field;
            // Hash each component first for domain separation
            let caller_hash: field = BHP256::hash_to_field(caller_field);
            let counter_hash: field = BHP256::hash_to_field(counter_field);
            let metadata_hash_hash: field = BHP256::hash_to_field(metadata_hash);
            // Combine hashed components and hash again for collision resistance
            let combined: field = BHP256::hash_to_field(caller_hash + counter_hash + metadata_hash_hash + 1field);
            let market_id: field = BHP256::hash_to_field(combined);
            
            // Increment counter for creator
            market_id_counter.set(creator, counter + 1u64);
            
            // Prevent re-initialization; market must not exist
            assert(!market_status.contains(market_id));
            // Defensive checks: ensure all per-market mappings are unset to prevent partial/duplicate initialization
            assert(!market_creator.contains(market_id));
            assert(!market_metadata_hash.contains(market_id));
            assert(!market_bond.contains(market_id));
            
            // Initialize market state
            // Initialize AMM reserves (50/50 starting point - equal reserves mean initial price is 0.5)
            let initial_liquidity_u128: u128 = initial_liquidity as u128;
            market_status.set(market_id, STATUS_OPEN);
            // CRITICAL: Initialize pool with initial_liquidity (bond is tracked separately)
            market_collateral_pool.set(market_id, initial_liquidity_u128);
            market_yes_reserve.set(market_id, initial_liquidity_u128);
            market_no_reserve.set(market_id, initial_liquidity_u128);
            market_fee_bps.set(market_id, fee_bps);
            market_initial_liquidity.set(market_id, initial_liquidity_u128);
            
            // Store creator address for provenance
            market_creator.set(market_id, creator);
            
            // Store metadata hash for indexers
            market_metadata_hash.set(market_id, metadata_hash);
            
            // Store creation bond separately (non-redeemable, keeps pool math clean for AMM)
            market_bond.set(market_id, bond_amount as u128);
            
            // Initialize price update mapping with derived price from reserves (50% = 5000 basis points)
            // Since yes_reserve == no_reserve, price = no_reserve * SCALE / (yes_reserve + no_reserve) = SCALE / 2
            let initial_price: u64 = SCALE / 2u64;
            last_price_update.set(market_id, initial_price);
        });
    }

    // NOTE: Public deposit/withdraw functions removed - use private versions for privacy
    // All user data is now stored in private records, not public mappings

    // Open position (first-time) - creates initial Position record. No existing position to consume.
    // SECURITY: Position.owner is set to self.signer (transaction signer), ensuring the record is encrypted
    // for the correct address. The Aleo runtime enforces that only the record owner can spend credit_record.
    async transition open_position_private(
        market_id: field,
        credit_record: credits.aleo/credits,
        amount: u64,
        status_hint: u8
    ) -> (Position, credits.aleo/credits, Future) {
        assert(amount > 0u64);
        assert(amount <= MAX_COLLATERAL);
        // Fast-fail market status precheck: avoid wasted proving work
        assert(status_hint == STATUS_OPEN);
        // Validate market state before transferring funds
        // NOTE: Mapping checks must be in async block, but execution is atomic.
        // If validations in the async block fail (market doesn't exist, not open, paused),
        // the entire transaction (including transfer) will revert.
        // This ensures we don't have "paid then failed" scenarios despite the transfer-first pattern.
        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, amount);
        let change_record = result.0;
        let updated_position = Position {
            owner: self.signer,  // Use transaction signer to ensure correct encryption
            market_id: market_id,
            yes_shares: 0u128,
            no_shares: 0u128,
            collateral_available: amount as u128,
            collateral_committed: 0u128,
            payout_claimed: false
        };
        return (updated_position, change_record, async {
            result.1.await();
            // All validation checks happen here before pool update
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);
            let current_pool: u128 = market_collateral_pool.contains(market_id) ? market_collateral_pool.get(market_id) : 0u128;
            market_collateral_pool.set(market_id, current_pool + amount as u128);
        });
    }

    // Private deposit - consumes existing Position, creates updated position with added collateral
    // SECURITY NOTE: caller is derived from existing_position.owner (better than open_position_private).
    // However, Leo cannot verify that the transaction signer (who must own credit_record) matches
    // existing_position.owner. The runtime enforces record ownership, but there's a mismatch risk:
    // if signer != position.owner, the transaction will fail at runtime when trying to consume the position.
    // This is actually safer than open_position_private because position ownership is cryptographically
    // enforced when consuming the Position record.
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
        let caller: address = existing_position.owner;  // Derive caller from consumed record (better than parameter)
        let existing_market_id: field = existing_position.market_id;
        
        // Validate position fields before transferring funds
        assert(amount > 0u64);
        assert(amount <= MAX_COLLATERAL);
        assert_eq(existing_market_id, market_id);
        // Fast-fail market status precheck: avoid wasted proving work
        assert(status_hint == STATUS_OPEN);
        
        // NOTE: Runtime enforces that transaction signer owns both credit_record and existing_position.
        // If signer != position.owner, position consumption will fail. If signer != credit_record.owner,
        // credit_record consumption will fail. This provides cryptographic binding.
        let result = credits.aleo/transfer_private_to_public(credit_record, self.address, amount);
        let change_record = result.0;
        
        let updated_position = Position {
            owner: caller,  // Derived from consumed position - runtime enforces position ownership
            market_id: market_id,
            yes_shares: existing_yes_shares,
            no_shares: existing_no_shares,
            collateral_available: existing_available + amount as u128,
            collateral_committed: existing_committed,
            payout_claimed: existing_payout_claimed
        };
        
        return (updated_position, change_record, async {
            result.1.await();
            // Market state validation checks happen here before pool update
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);
            let current_pool: u128 = market_collateral_pool.contains(market_id) ? market_collateral_pool.get(market_id) : 0u128;
            let new_pool: u128 = current_pool + amount as u128;
            market_collateral_pool.set(market_id, new_pool);
        });
    }

    // AMM Swap Functions
    // Swap collateral for YES shares using AMM
    // When collateral enters: mint equal YES + NO tokens, add YES to user, NO to AMM, then swap
    // ESCROW-FIRST MODEL: Swaps spend from collateral_available and move to collateral_committed (no credit_record transfer needed)
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
        let caller: address = existing_position.owner;  // Derive caller from consumed record
        let existing_market_id: field = existing_position.market_id;
        
        // Basic validation
        assert(collateral_in > 0u64);
        assert_eq(existing_market_id, market_id);
        // CRITICAL: User must have sufficient available collateral to swap
        assert(collateral_in as u128 <= existing_available);
        // Fee safety: prevent extreme fees even if on-chain value is corrupted
        assert(fee_bps <= MAX_FEE_BPS);
        // Fast-fail market status precheck: avoid wasted proving work
        assert(status_hint == STATUS_OPEN);
        
        // Validate reserves are non-zero (prevent division by zero)
        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);
        
        // AMM redesign: Mint equal YES + NO tokens when collateral enters
        // Then swap NO → YES (sell NO, get YES) to get desired YES tokens
        let collateral_in_u128: u128 = collateral_in as u128;
        
        // Mint equal YES and NO tokens (1:1 with collateral, no fee on mint)
        let minted_yes: u128 = collateral_in_u128;
        let minted_no: u128 = collateral_in_u128;
        
        // Apply fee to swap input (NO tokens being swapped)
        // Fee is applied to the tokens being swapped, not the collateral
        let fee: u128 = (minted_no * fee_bps as u128) / FEE_SCALE as u128;
        let no_after_fee: u128 = minted_no - fee;
        
        // Swap NO → YES using CPMM: sell NO (after fee), get YES tokens
        // Formula: yes_out = (no_after_fee * yes_reserve) / (no_reserve + no_after_fee)
        let yes_out: u128 = (no_after_fee * yes_reserve) / (no_reserve + no_after_fee);
        
        // User gets: minted_yes (from mint) + yes_out (from swap) = total YES tokens
        let total_yes_for_user: u128 = minted_yes + yes_out;
        
        // Slippage protection
        assert(total_yes_for_user >= min_yes_out);
        
        // Underflow protection: ensure we don't subtract more than available
        assert(yes_reserve >= yes_out);
        
        // Calculate new reserves (only outcome tokens, no collateral)
        // YES reserve decreases (we gave YES to user), NO reserve increases (we received full NO from user, fee stays in pool)
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
            // Verify market is open and not paused
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);
            
            // Verify provided reserves match on-chain (atomicity check)
            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);
            assert_eq(market_fee_bps.get(market_id), fee_bps);
            
            // Update reserves
            market_yes_reserve.set(market_id, yes_reserve_new);
            market_no_reserve.set(market_id, no_reserve_new);
            
            // NOTE: Do NOT add collateral_in to market_collateral_pool here
            // collateral_in is already in escrow (Position.collateral_available), which was funded
            // by a deposit that already increased market_collateral_pool. Adding again would inflate the pool.
            
            // Track fees separately as protocol revenue (doesn't affect redemption backing)
            // NOTE: fee_collected is accounting-only until a fee withdrawal/conversion mechanism exists.
            // Fees are tracked in outcome-token units while pool is in credits.
            let current_fees: u128 = market_fee_collected.contains(market_id) ? market_fee_collected.get(market_id) : 0u128;
            market_fee_collected.set(market_id, current_fees + fee);
            
            // Update price for indexing
            let price_yes: u64 = ((no_reserve_new * SCALE as u128) / (yes_reserve_new + no_reserve_new)) as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    // Swap collateral for NO shares using AMM
    // When collateral enters: mint equal YES + NO tokens, add NO to user, YES to AMM, then swap
    // ESCROW-FIRST MODEL: Swaps spend from collateral_available and move to collateral_committed (no credit_record transfer needed)
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
        let caller: address = existing_position.owner;  // Derive caller from consumed record
        let existing_market_id: field = existing_position.market_id;
        
        // Basic validation
        assert(collateral_in > 0u64);
        assert(collateral_in <= MAX_COLLATERAL);
        assert_eq(existing_market_id, market_id);
        // CRITICAL: User must have sufficient available collateral to swap
        assert(collateral_in as u128 <= existing_available);
        // Fee safety: prevent extreme fees even if on-chain value is corrupted
        assert(fee_bps <= MAX_FEE_BPS);
        // Fast-fail market status precheck: avoid wasted proving work
        assert(status_hint == STATUS_OPEN);
        
        // Validate reserves are non-zero (prevent division by zero)
        assert(yes_reserve > 0u128);
        assert(no_reserve > 0u128);
        
        // AMM redesign: Mint equal YES + NO tokens when collateral enters
        // Then swap YES → NO (sell YES, get NO) to get desired NO tokens
        let collateral_in_u128: u128 = collateral_in as u128;
        
        // Mint equal YES and NO tokens (1:1 with collateral, no fee on mint)
        let minted_yes: u128 = collateral_in_u128;
        let minted_no: u128 = collateral_in_u128;
        
        // Apply fee to swap input (YES tokens being swapped)
        // Fee is applied to the tokens being swapped, not the collateral
        let fee: u128 = (minted_yes * fee_bps as u128) / FEE_SCALE as u128;
        let yes_after_fee: u128 = minted_yes - fee;
        
        // Swap YES → NO using CPMM: sell YES (after fee), get NO tokens
        // Formula: no_out = (yes_after_fee * no_reserve) / (yes_reserve + yes_after_fee)
        let no_out: u128 = (yes_after_fee * no_reserve) / (yes_reserve + yes_after_fee);
        
        // User gets: minted_no (from mint) + no_out (from swap) = total NO tokens
        let total_no_for_user: u128 = minted_no + no_out;
        
        // Slippage protection
        assert(total_no_for_user >= min_no_out);
        
        // Underflow protection: ensure we don't subtract more than available
        assert(no_reserve >= no_out);
        
        // Calculate new reserves (only outcome tokens, no collateral)
        // NO reserve decreases (we gave NO to user), YES reserve increases (we received full YES from user, fee stays in pool)
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
            // Verify market is open and not paused
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), status_hint);
            
            // Verify provided reserves match on-chain (atomicity check)
            assert_eq(market_yes_reserve.get(market_id), yes_reserve);
            assert_eq(market_no_reserve.get(market_id), no_reserve);
            assert_eq(market_fee_bps.get(market_id), fee_bps);
            
            // Update reserves
            market_yes_reserve.set(market_id, yes_reserve_new);
            market_no_reserve.set(market_id, no_reserve_new);
            
            // NOTE: Do NOT add collateral_in to market_collateral_pool here
            // collateral_in is already in escrow (Position.collateral_available), which was funded
            // by a deposit that already increased market_collateral_pool. Adding again would inflate the pool.
            
            // Track fees separately as protocol revenue (doesn't affect redemption backing)
            // NOTE: fee_collected is accounting-only until a fee withdrawal/conversion mechanism exists.
            // Fees are tracked in outcome-token units while pool is in credits.
            let current_fees: u128 = market_fee_collected.contains(market_id) ? market_fee_collected.get(market_id) : 0u128;
            market_fee_collected.set(market_id, current_fees + fee);
            
            // Update price for indexing
            let price_yes: u64 = ((no_reserve_new * SCALE as u128) / (yes_reserve_new + no_reserve_new)) as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    // Merge tokens to collateral (pre-resolution exit)
    // Burns equal amounts of YES and NO tokens to receive collateral back
    // This is the only valid pre-resolution exit path (conditional-token semantics)
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
        let caller: address = existing_position.owner;  // Derive caller from consumed record
        let existing_market_id: field = existing_position.market_id;
        
        // Basic validation
        assert(merge_amount > 0u128);
        assert_eq(existing_market_id, market_id);
        assert(existing_yes_shares >= merge_amount);
        assert(existing_no_shares >= merge_amount);
        
        // Merge: burn equal amounts of YES and NO to get collateral (1:1 ratio)
        let collateral_out: u128 = merge_amount;
        let collateral_out_u64: u64 = collateral_out as u64;
        
        // Slippage protection
        assert(collateral_out_u64 >= min_collateral_out);
        
        // CRITICAL: Ensure user has sufficient committed collateral to cover the payout
        assert(existing_committed >= collateral_out);
        
        // Transfer collateral to user
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
            // Verify market is open and not paused
            assert(market_status.contains(market_id));
            assert_eq(market_status.get(market_id), STATUS_OPEN);
            
            // NOTE: Merge does NOT affect AMM reserves - reserves only change due to swaps
            // Reserves represent AMM pool inventory, not total outstanding shares
            
            // Update collateral pool (subtract collateral_out)
            let current_pool: u128 = market_collateral_pool.contains(market_id) ? market_collateral_pool.get(market_id) : 0u128;
            assert(current_pool >= collateral_out);
            market_collateral_pool.set(market_id, current_pool - collateral_out);
            
            // Update price for indexing (reserves unchanged by merge, use current reserves)
            let current_yes_reserve: u128 = market_yes_reserve.get(market_id);
            let current_no_reserve: u128 = market_no_reserve.get(market_id);
            let price_yes: u64 = ((current_no_reserve * SCALE as u128) / (current_yes_reserve + current_no_reserve)) as u64;
            last_price_update.set(market_id, price_yes);
        });
    }

    // Admin Functions
    // NOTE: set_price function removed - price is now derived from AMM reserves automatically

    // Resolve market - admin only
    async transition resolve(
        market_id: field,
        outcome: bool
    ) -> Future {
        // Access control: only admin can resolve (use transaction signer, not parameter)
        assert_eq(self.signer, ADMIN);
        
        return async {
            // Validate market is open (cannot resolve twice)
            // CRITICAL: RESOLVED is terminal - cannot resolve paused or already-resolved markets
            assert(market_status.contains(market_id));
            let status: u8 = market_status.get(market_id);
            assert_eq(status, STATUS_OPEN);
            
            // Set outcome and mark as resolved
            market_outcome.set(market_id, outcome);
            market_status.set(market_id, STATUS_RESOLVED);
            
            // Store in output mapping for indexing
            last_resolve.set(market_id, outcome);
        };
    }

    // Pause market - admin only
    async transition pause(
        market_id: field
    ) -> Future {
        // Access control: only admin can pause (use transaction signer, not parameter)
        assert_eq(self.signer, ADMIN);
        
        return async {
            // Validate market exists and is OPEN (cannot pause resolved markets)
            assert(market_status.contains(market_id));
            let status: u8 = market_status.get(market_id);
            assert_eq(status, STATUS_OPEN);
            
            // Set pause state
            market_status.set(market_id, STATUS_PAUSED);
        };
    }

    // Unpause market - admin only
    async transition unpause(
        market_id: field
    ) -> Future {
        // Access control: only admin can unpause (use transaction signer, not parameter)
        assert_eq(self.signer, ADMIN);
        
        return async {
            // Validate market exists and is paused (cannot unpause resolved markets)
            assert(market_status.contains(market_id));
            let status: u8 = market_status.get(market_id);
            assert_eq(status, STATUS_PAUSED);
            
            // Remove pause state
            market_status.set(market_id, STATUS_OPEN);
        };
    }

    // Withdraw private - consumes Position, converts public balance to private record
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
        let caller: address = existing_position.owner;  // Derive caller from consumed record
        let existing_market_id: field = existing_position.market_id;
        
        // Prevent withdrawal if user holds shares (protocol solvency protection)
        assert(existing_yes_shares == 0u128);
        assert(existing_no_shares == 0u128);
        // CRITICAL: Cannot withdraw while any backing is committed
        assert(existing_committed == 0u128);
        assert(amount > 0u64);
        // CRITICAL: Enforce that user can only withdraw from available collateral
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
            // Allow withdrawals when market is OPEN or RESOLVED (users need to withdraw after resolution)
            let status: u8 = market_status.get(market_id);
            assert(status == STATUS_OPEN || status == STATUS_RESOLVED);
            assert_eq(existing_market_id, market_id);
            let current_pool: u128 = market_collateral_pool.contains(market_id) ? market_collateral_pool.get(market_id) : 0u128;
            assert(current_pool >= amount as u128);
            market_collateral_pool.set(market_id, current_pool - amount as u128);
        });
    }

    // Redeem private - consumes Position, converts public balance to private record for payout
    // 1:1 redemption model: each winning token = 1 collateral unit
    // NOTE: Outcome parameter is kept due to Leo architecture constraints (transfers must be 
    // before async blocks, but mappings can only be read in async blocks). However, we read
    // outcome from mapping in async block and validate it matches the parameter, using the
    // mapping as the source of truth to reduce UX mistakes.
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
        let caller: address = existing_position.owner;  // Derive caller from consumed record
        let existing_market_id: field = existing_position.market_id;
        
        // Early double-redeem prevention: fail fast before payout calculation
        assert(!existing_payout_claimed);
        
        // Calculate winning shares and payout (1:1 redemption)
        let winning_shares: u128 = outcome ? existing_yes_shares : existing_no_shares;
        assert(winning_shares > 0u128);
        
        // 1:1 payout: each winning token = 1 collateral unit
        assert(winning_shares <= 18446744073709551615u128);
        let payout: u64 = winning_shares as u64;
        
        // CRITICAL: Ensure user has sufficient committed collateral to cover the payout
        assert(existing_committed >= payout as u128);
        
        // Transfer payout (1:1 for winning tokens)
        let result = credits.aleo/transfer_public_to_private(caller, payout);
        let credit_record = result.0;
        
        // Position shares are burned after redemption, and collateral_committed is decremented by payout
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
            
            // Read outcome from mapping and validate it matches parameter (mapping is source of truth)
            let outcome_from_mapping: bool = market_outcome.get(market_id);
            assert_eq(outcome_from_mapping, outcome);
            
            // Update collateral pool
            let current_pool: u128 = market_collateral_pool.contains(market_id) ? market_collateral_pool.get(market_id) : 0u128;
            assert(current_pool >= payout as u128);
            market_collateral_pool.set(market_id, current_pool - payout as u128);
        });
    }

}
