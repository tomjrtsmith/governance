// SPDX-License-Identifier: MIT
pragma solidity =0.8.4;

library Vault {
  /************************************************
   *  IMMUTABLES & CONSTANTS
   ***********************************************/

  // Placeholder uint value to prevent cold writes
  uint256 internal constant PLACEHOLDER_UINT = 1;

  struct VaultParams {
    // Token decimals for vault shares
    uint8 decimals;
    // Asset used in vault
    address asset;
    // Minimum supply of the vault shares issued, for ETH it's 10**10
    uint56 minimumSupply;
    // Vault cap
    uint104 cap;
  }

  struct VaultState {
    // 32 byte slot 1
    //  Current round number. `round` represents the number of `period`s elapsed.
    uint16 round;
    // Amount that is currently locked for securing the vaults
    uint104 lockedAmount;
    // 32 byte slot 2
    // Stores the total tally of how much of `asset` there is
    // to be used to mint rTHETA tokens
    uint128 totalPending;
    // Amount locked for scheduled withdrawals;
    uint128 queuedWithdrawShares;
    // Next timestamp for RBN buyback
    uint256 nextBuyback;
  }

  struct DepositReceipt {
    // Maximum of 65535 rounds. Assuming 1 round is 7 days, maximum is 1256 years.
    uint16 round;
    // Deposit amount, max 20,282,409,603,651 or 20 trillion ETH deposit
    uint104 amount;
    // Unredeemed shares balance
    uint128 unredeemedShares;
  }

  struct Withdrawal {
    // Maximum of 65535 rounds. Assuming 1 round is 7 days, maximum is 1256 years.
    uint16 round;
    // Number of shares withdrawn
    uint128 shares;
  }
}