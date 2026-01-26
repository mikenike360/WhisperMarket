import prediction_market.aleo;

program test_prediction_market.aleo {

    // Test addresses: PROG is market key, USER is non-admin, ADMIN is from the program
    const PROG: address = aleo1xh0ncflwkfzga983lwujsha729c8nwu7phfn8aw7h3gahhj0ms8qytrxec;
    const USER: address = aleo1nxjp6z5jzcup2evcr5kjutzd9t73kmynse5wymjzkpte6y2rvsgq2yhmu8;
    const ADMIN: address = aleo1xh0ncflwkfzga983lwujsha729c8nwu7phfn8aw7h3gahhj0ms8qytrxec;
    const STATUS_OPEN: u8 = 0u8;
    const STATUS_RESOLVED: u8 = 1u8;

    @noupgrade
    async constructor() {
        // The Leo compiler automatically generates the constructor logic.
    }

    // --- Trading math: Buy YES share calculation ---
    // At price_yes=6000 (60%), 100 collateral -> shares = 100*10000/6000 = 166
    @test
    script test_buy_yes_share_calculation() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 100u64); f.await(); }
        let shares: u128 = Mapping::get(prediction_market.aleo/user_yes_shares, USER);
        assert_eq(shares, 166u128);
        let total: u128 = Mapping::get(prediction_market.aleo/total_yes_shares, PROG);
        assert_eq(total, 166u128);
    }

    // --- Trading math: Buy NO share calculation ---
    // At price_yes=6000, price_no=4000. 100 collateral -> shares = 100*10000/4000 = 250
    @test
    script test_buy_no_share_calculation() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_no(USER, PROG, 100u64); f.await(); }
        let shares: u128 = Mapping::get(prediction_market.aleo/user_no_shares, USER);
        assert_eq(shares, 250u128);
        let total: u128 = Mapping::get(prediction_market.aleo/total_no_shares, PROG);
        assert_eq(total, 250u128);
    }

    // --- Cannot buy when market resolved ---
    @test
    @should_fail
    script test_cannot_buy_when_resolved() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, true); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 50u64); f.await(); }
    }

    // --- Cannot buy when paused ---
    @test
    @should_fail
    script test_cannot_buy_when_paused() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/pause(ADMIN, PROG); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 50u64); f.await(); }
    }

    // --- Redemption: payout and user_redeemed set ---
    // User deposits 200, buys YES 200 at 6000 -> 333 shares. Resolve YES. Payout = 333/333 * 200 = 200.
    @test
    script test_redemption_sets_redeemed() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 200u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 200u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, true); f.await(); }
        { let f: Future = prediction_market.aleo/redeem(USER, PROG, 200u64); f.await(); }
        let redeemed: bool = Mapping::get(prediction_market.aleo/user_redeemed, USER);
        assert_eq(redeemed, true);
    }

    // --- Double redemption prevention ---
    @test
    @should_fail
    script test_double_redemption_fails() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, true); f.await(); }
        { let f: Future = prediction_market.aleo/redeem(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/redeem(USER, PROG, 100u64); f.await(); }
    }

    // --- Access control: only admin can set_price ---
    @test
    @should_fail
    script test_only_admin_can_set_price() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/set_price(USER, PROG, 5000u64); f.await(); }
    }

    // --- Access control: only admin can resolve ---
    @test
    @should_fail
    script test_only_admin_can_resolve() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(USER, PROG, true); f.await(); }
    }

    // --- Access control: only admin can pause ---
    @test
    @should_fail
    script test_only_admin_can_pause() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/pause(USER, PROG); f.await(); }
    }

    // --- Access control: only admin can unpause ---
    @test
    @should_fail
    script test_only_admin_can_unpause() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/pause(ADMIN, PROG); f.await(); }
        { let f: Future = prediction_market.aleo/unpause(USER, PROG); f.await(); }
    }

    // --- Price bounds: init with 0 fails ---
    @test
    @should_fail
    script test_init_price_zero_fails() {
        { let f: Future = prediction_market.aleo/init(PROG, 0u64); f.await(); }
    }

    // --- Price bounds: init with SCALE (10000) fails ---
    @test
    @should_fail
    script test_init_price_scale_fails() {
        { let f: Future = prediction_market.aleo/init(PROG, 10000u64); f.await(); }
    }

    // --- Edge: deposit zero fails ---
    @test
    @should_fail
    script test_deposit_zero_fails() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 0u64); f.await(); }
    }

    // --- Edge: buy with zero collateral fails ---
    @test
    @should_fail
    script test_buy_zero_collateral_fails() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 0u64); f.await(); }
    }

    // --- Cannot redeem before resolution ---
    @test
    @should_fail
    script test_redeem_before_resolve() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/redeem(USER, PROG, 100u64); f.await(); }
    }

    // --- Cannot redeem losing side (user has YES, outcome is NO) ---
    @test
    @should_fail
    script test_cannot_redeem_losing_side() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, false); f.await(); }
        { let f: Future = prediction_market.aleo/redeem(USER, PROG, 0u64); f.await(); }
    }

    // --- Price boundary: init with 1 is valid ---
    @test
    script test_init_price_min_valid() {
        { let f: Future = prediction_market.aleo/init(PROG, 1u64); f.await(); }
        let p: u64 = Mapping::get(prediction_market.aleo/market_price_yes, PROG);
        assert_eq(p, 1u64);
        let s: u8 = Mapping::get(prediction_market.aleo/market_status, PROG);
        assert_eq(s, STATUS_OPEN);
    }

    // --- Cannot set_price after resolve ---
    @test
    @should_fail
    script test_no_set_price_after_resolve() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, true); f.await(); }
        { let f: Future = prediction_market.aleo/set_price(ADMIN, PROG, 5000u64); f.await(); }
    }

    // --- Cannot deposit to resolved market ---
    @test
    @should_fail
    script test_no_deposit_when_resolved() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, true); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 50u64); f.await(); }
    }

    // --- Cannot deposit to paused market ---
    @test
    @should_fail
    script test_no_deposit_when_paused() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/pause(ADMIN, PROG); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 50u64); f.await(); }
    }

    // --- Redemption rejects overpayment ---
    @test
    @should_fail
    script test_redeem_rejects_overpay() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, true); f.await(); }
        // Try to redeem with more than actual_payout (should fail)
        { let f: Future = prediction_market.aleo/redeem(USER, PROG, 101u64); f.await(); }
    }

    // --- Withdraw: can withdraw unused collateral when open ---
    @test
    script test_withdraw_when_open() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 200u64); f.await(); }
        { let f: Future = prediction_market.aleo/buy_yes(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/withdraw(USER, PROG, 50u64); f.await(); }
    }

    // --- Cannot withdraw when market resolved ---
    @test
    @should_fail
    script test_no_withdraw_when_resolved() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/resolve(ADMIN, PROG, true); f.await(); }
        { let f: Future = prediction_market.aleo/withdraw(USER, PROG, 50u64); f.await(); }
    }

    // --- Cannot withdraw when market paused ---
    @test
    @should_fail
    script test_no_withdraw_when_paused() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/pause(ADMIN, PROG); f.await(); }
        { let f: Future = prediction_market.aleo/withdraw(USER, PROG, 50u64); f.await(); }
    }

    // --- Cannot withdraw with insufficient collateral ---
    @test
    @should_fail
    script test_withdraw_insufficient() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/withdraw(USER, PROG, 150u64); f.await(); }
    }

    // --- Cannot withdraw zero amount ---
    @test
    @should_fail
    script test_withdraw_zero_fails() {
        { let f: Future = prediction_market.aleo/init(PROG, 6000u64); f.await(); }
        { let f: Future = prediction_market.aleo/deposit(USER, PROG, 100u64); f.await(); }
        { let f: Future = prediction_market.aleo/withdraw(USER, PROG, 0u64); f.await(); }
    }

    // --- Minimal transition test (Leo may require at least one transition) ---
    @test
    transition test_placeholder() {
        assert_eq(1u8, 1u8);
    }

    // ============================================================================
    // POST-MVP HARDENING REGRESSION TESTS
    // NOTE: These tests need to be updated for the private record API.
    // Current test file uses old public API (deposit/buy_yes/etc).
    // These tests should use: open_position_private, deposit_private, 
    // swap_collateral_for_yes_private, redeem_private, etc.
    // ============================================================================

    // --- T1: Redeem then deposit (should succeed) ---
    // Flow: open_position_private -> swap_collateral_for_yes_private -> resolve -> 
    //       redeem_private -> deposit_private (should succeed)
    // Verify: collateral_available increases, market_collateral_pool increases
    // NOTE: This test verifies that payout_claimed flag doesn't block deposits
    // @test
    // script test_redeem_then_deposit() {
    //     // TODO: Update for private record API
    //     // 1. open_position_private(amount=200)
    //     // 2. swap_collateral_for_yes_private(collateral_in=100)
    //     // 3. resolve(outcome=true)
    //     // 4. redeem_private(outcome=true) -> payout_claimed=true
    //     // 5. deposit_private(amount=50) -> should succeed
    //     // Verify: position.collateral_available increased, pool increased
    // }

    // --- T2: Redeem then swap (should fail due to market status) ---
    // Flow: After resolve + redeem_private, attempt swap_collateral_for_yes_private
    // Expected: Revert due to market_status != STATUS_OPEN in finalize
    // NOTE: This test verifies that market status check (not payout_claimed) blocks swaps
    // @test
    // @should_fail
    // script test_redeem_then_swap_fails() {
    //     // TODO: Update for private record API
    //     // 1. open_position_private(amount=200)
    //     // 2. swap_collateral_for_yes_private(collateral_in=100)
    //     // 3. resolve(outcome=true)
    //     // 4. redeem_private(outcome=true) -> payout_claimed=true
    //     // 5. swap_collateral_for_yes_private(collateral_in=50) -> should fail
    //     // Expected: Revert in finalize due to market_status != STATUS_OPEN
    // }

    // --- T3: Double redeem prevention ---
    // Flow: redeem_private once -> attempt redeem_private again with same Position
    // Expected: Revert due to assert(!existing_payout_claimed) in finalize
    // NOTE: This test verifies payout_claimed flag prevents double redemption
    // @test
    // @should_fail
    // script test_double_redeem_prevention() {
    //     // TODO: Update for private record API
    //     // 1. open_position_private(amount=200)
    //     // 2. swap_collateral_for_yes_private(collateral_in=100)
    //     // 3. resolve(outcome=true)
    //     // 4. redeem_private(outcome=true) -> payout_claimed=true
    //     // 5. redeem_private(outcome=true) again -> should fail
    //     // Expected: Revert due to assert(!existing_payout_claimed) in finalize
    // }

    // --- T4: Fee cap assert ---
    // Flow: Attempt swap_collateral_for_yes_private with fee_bps > MAX_FEE_BPS
    // Expected: Revert due to assert(fee_bps <= MAX_FEE_BPS) in prelude
    // NOTE: This test verifies fee safety assert prevents extreme fees
    // @test
    // @should_fail
    // script test_fee_cap_assert() {
    //     // TODO: Update for private record API
    //     // 1. open_position_private(amount=200)
    //     // 2. swap_collateral_for_yes_private(collateral_in=100, fee_bps=MAX_FEE_BPS+1)
    //     // Expected: Revert due to assert(fee_bps <= MAX_FEE_BPS) before AMM math
    // }
}
