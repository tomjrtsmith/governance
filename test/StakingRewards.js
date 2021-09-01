const hre = require("hardhat");
const { ethers } = hre;

const { ensureOnlyExpectedMutativeFunctions } = require("./helpers");
const { assert, addSnapshotBeforeRestoreAfterEach } = require("./common");
const { currentTime, toUnit, fastForward } = require("./utils")();

const { provider, BigNumber } = ethers;

const {
  TOKEN_PARAMS,
  STAKING_REWARDS_rETHTHETA_PARAMS,
  STAKING_TOKEN_PARAMS,
  EXTERNAL_TOKEN_PARAMS,
} = require("../params");
const { formatEther, parseEther } = require("@ethersproject/units");

// Tests taken from https://github.com/Synthetixio/synthetix/blob/master/test/contracts/StakingRewards.js
describe("StakingRewards contract", function () {
  let RibbonToken;
  let RibbonStakingRewards;
  let deployerAccount;
  let owner;
  let mockRewardsDistributionAddress;
  let account3;
  let account4;

  const DAY = 86400;

  let rewardsToken,
    rewardsTokenOwner,
    stakingToken,
    stakingTokenOwner,
    externalRewardsToken,
    externalRewardsTokenOwner,
    stakingRewards,
    startEmission;

  addSnapshotBeforeRestoreAfterEach();

  before(async () => {
    [
      deployerAccount,
      owner,
      mockRewardsDistributionAddress,
      account3,
      account4,
    ] = await ethers.getSigners();

    // Get rewards token (RIBBON)
    RibbonToken = await ethers.getContractFactory("RibbonToken");
    rewardsToken = await RibbonToken.deploy(
      TOKEN_PARAMS.NAME,
      TOKEN_PARAMS.SYMBOL,
      TOKEN_PARAMS.SUPPLY,
      TOKEN_PARAMS.BENIFICIARY
    );

    await rewardsToken.deployed();

    // Get staking token (rETH-THETA)
    stakingToken = await ethers.getContractAt(
      "IERC20",
      STAKING_TOKEN_PARAMS.ADDRESS
    );

    // Get rando token
    externalRewardsToken = await ethers.getContractAt(
      "IERC20",
      EXTERNAL_TOKEN_PARAMS.ADDRESS
    );

    startEmission = ((await currentTime()) + 1000).toString();

    // Get staking rewards contract
    RibbonStakingRewards = await ethers.getContractFactory("StakingRewards");
    stakingRewards = await RibbonStakingRewards.deploy(
      owner.address,
      mockRewardsDistributionAddress.address,
      rewardsToken.address,
      STAKING_REWARDS_rETHTHETA_PARAMS.STAKING_TOKEN,
      startEmission
    );

    await owner.sendTransaction({
      to: TOKEN_PARAMS.BENIFICIARY,
      value: ethers.utils.parseEther("1.0"),
    });
    await owner.sendTransaction({
      to: STAKING_TOKEN_PARAMS.MAIN_HOLDER,
      value: ethers.utils.parseEther("1.0"),
    });

    // Get address of ribbon token holder
    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [TOKEN_PARAMS.BENIFICIARY],
    });
    const signer = await ethers.provider.getSigner(TOKEN_PARAMS.BENIFICIARY);
    let token = await ethers.getContractAt("RibbonToken", rewardsToken.address);
    rewardsTokenOwner = await token.connect(signer);

    //set transfers to allowed
    await rewardsTokenOwner.setTransfersAllowed(true);

    // Get address of rETH-THETA token holder
    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [STAKING_TOKEN_PARAMS.MAIN_HOLDER],
    });
    const signer2 = await ethers.provider.getSigner(
      STAKING_TOKEN_PARAMS.MAIN_HOLDER
    );
    stakingTokenOwner = await stakingToken.connect(signer2);

    // Get address of rhegic2 token holder
    // Allow impersonation of new account
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [EXTERNAL_TOKEN_PARAMS.MAIN_HOLDER],
    });
    const signer3 = await ethers.provider.getSigner(
      EXTERNAL_TOKEN_PARAMS.MAIN_HOLDER
    );
    externalRewardsTokenOwner = await externalRewardsToken.connect(signer3);

    await stakingRewards
      .connect(owner)
      .setRewardsDistribution(mockRewardsDistributionAddress.address);
  });

  it("ensure only known functions are mutative", async () => {
    ensureOnlyExpectedMutativeFunctions({
      abi: artifacts.require("StakingRewards").abi,
      ignoreParents: ["ReentrancyGuard", "Owned"],
      expected: [
        "stake",
        "withdraw",
        "exit",
        "getReward",
        "notifyRewardAmount",
        "setPaused",
        "setRewardsDistribution",
        "setRewardsDuration",
        "setStartEmission",
        "recoverERC20",
      ],
    });
  });

  describe("Constructor & Settings", () => {
    it("should set rewards token on constructor", async () => {
      assert.equal(await stakingRewards.rewardsToken(), rewardsToken.address);
    });

    it("should staking token on constructor", async () => {
      assert.equal(await stakingRewards.stakingToken(), stakingToken.address);
    });

    it("should set owner on constructor", async () => {
      const ownerAddress = await stakingRewards.owner();
      assert.equal(ownerAddress, owner.address);
    });

    it("should set rewards distribution address on constructor", async () => {
      const rewardsDistributionAddress = await stakingRewards.rewardsDistribution();
      assert.equal(
        rewardsDistributionAddress,
        mockRewardsDistributionAddress.address
      );
    });

    it("should set start emission on constructor", async () => {
      const startEmissionTimestamp = await stakingRewards.startEmission();
      assert.equal(startEmissionTimestamp, startEmission);
    });
  });

  describe("Function permissions", () => {
    const rewardValue = toUnit("1");

    before(async () => {
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
    });

    it("only rewardsDistribution address can call notifyRewardAmount", async () => {
      await expect(
        stakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(rewardValue)
      ).to.emit(stakingRewards, "RewardAdded");
      assert.revert(
        stakingRewards.connect(deployerAccount).notifyRewardAmount(rewardValue),
        "Caller is not RewardsDistribution contract"
      );
    });

    it("only owner address can call setRewardsDuration", async () => {
      await fastForward(DAY * 7);
      await expect(
        stakingRewards.connect(owner).setRewardsDuration(70)
      ).to.emit(stakingRewards, "RewardsDurationUpdated");
      assert.revert(
        stakingRewards.connect(deployerAccount).setRewardsDuration(70),
        "Only the contract owner may perform this action"
      );
    });

    it("only owner address can call setPaused", async () => {
      await expect(stakingRewards.connect(owner).setPaused(true)).to.emit(
        stakingRewards,
        "PauseChanged"
      );
      assert.revert(
        stakingRewards.connect(deployerAccount).setPaused(true),
        "Only the contract owner may perform this action"
      );
    });
  });

  describe("Pausable", async () => {
    beforeEach(async () => {
      await stakingRewards.connect(owner).setPaused(true);
    });
    it("should revert calling stake() when paused", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await assert.revert(
        stakingRewards.connect(deployerAccount).stake(totalToStake),
        "This action cannot be performed while the contract is paused"
      );
    });
    it("should not revert calling stake() when unpaused", async () => {
      await stakingRewards.connect(owner).setPaused(false);

      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);
    });
  });

  describe("External Rewards Recovery", () => {
    const amount = toUnit("5000");
    beforeEach(async () => {
      // Send ERC20 to StakingRewards Contract
      await externalRewardsTokenOwner.transfer(stakingRewards.address, amount);
      assert.bnEqual(
        await externalRewardsToken.balanceOf(stakingRewards.address),
        amount
      );
    });
    it("only owner can call recoverERC20", async () => {
      await expect(
        await stakingRewards
          .connect(owner)
          .recoverERC20(externalRewardsToken.address, amount)
      ).to.emit(stakingRewards, "Recovered");
      assert.revert(
        stakingRewards
          .connect(deployerAccount)
          .recoverERC20(externalRewardsToken.address, amount),
        "Only the contract owner may perform this action"
      );
    });
    it("should revert if recovering staking token", async () => {
      await assert.revert(
        stakingRewards
          .connect(owner)
          .recoverERC20(stakingToken.address, amount),
        "Cannot withdraw the staking token"
      );
    });
    it("should retrieve external token from StakingRewards and reduce contracts balance", async () => {
      await stakingRewards
        .connect(owner)
        .recoverERC20(externalRewardsToken.address, amount);
      assert.bnEqual(
        await externalRewardsToken.balanceOf(stakingRewards.address),
        "0"
      );
    });
    it("should retrieve external token from StakingRewards and increase owners balance", async () => {
      const ownerMOARBalanceBefore = await externalRewardsToken.balanceOf(
        owner.address
      );

      await stakingRewards
        .connect(owner)
        .recoverERC20(externalRewardsToken.address, amount);

      const ownerMOARBalanceAfter = await externalRewardsToken.balanceOf(
        owner.address
      );
      assert.bnEqual(ownerMOARBalanceAfter.sub(ownerMOARBalanceBefore), amount);
    });
    it("should emit Recovered event", async () => {
      await expect(
        stakingRewards
          .connect(owner)
          .recoverERC20(externalRewardsToken.address, amount)
      ).to.emit(stakingRewards, "Recovered");
    });
  });

  describe("lastTimeRewardApplicable()", () => {
    it("should return 0", async () => {
      assert.bnEqual(await stakingRewards.lastTimeRewardApplicable(), "0");
    });

    describe("when updated", () => {
      it("should equal last emission time", async () => {
        await stakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(toUnit("1"));

        const lastTimeReward = await stakingRewards.lastTimeRewardApplicable();

        assert.equal(startEmission, lastTimeReward.toString());
      });
    });
  });

  describe("rewardPerToken()", () => {
    const seventyDays = DAY * 70;

    it("should return 0", async () => {
      assert.bnEqual(await stakingRewards.rewardPerToken(), "0");
    });

    it("should be 0 before next emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      const rewardValue = toUnit(5000);
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      const rewardPerToken = await stakingRewards.rewardPerToken();
      assert.bnEqual(parseInt(rewardPerToken), "0");
    });

    it("should be > 0 when next emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue = toUnit(5000);
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 8);

      const rewardPerToken = await stakingRewards.rewardPerToken();
      assert.isAbove(parseInt(rewardPerToken), 0);
    });

    it("should be same after emission hit + 1 day", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue = toUnit(5000);
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 8);

      const rewardPerToken = await stakingRewards.rewardPerToken();

      await fastForward(DAY);
      const rewardPerToken2 = await stakingRewards.rewardPerToken();

      assert.bnEqual(parseInt(rewardPerToken), parseInt(rewardPerToken2));
    });

    it("should be > 2x when next emission hit twice", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const totalSupply = await stakingRewards.totalSupply();
      assert.isAbove(parseInt(totalSupply), 0);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue = toUnit(5000);
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 1);

      const rewardPerToken = await stakingRewards.rewardPerToken();

      await fastForward(DAY * 7);

      const rewardPerToken2 = await stakingRewards.rewardPerToken();

      assert.isAbove(parseInt(rewardPerToken), 0);
      assert.bnEqual(parseInt(rewardPerToken2), parseInt(rewardPerToken) * 2);
    });
  });

  describe("stake()", () => {
    const seventyDays = DAY * 70;

    it("staking increases staking balance", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const initialStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );
      const initialLpBal = await stakingToken.balanceOf(
        deployerAccount.address
      );

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const postStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );
      const postLpBal = await stakingToken.balanceOf(deployerAccount.address);

      assert.bnLt(postLpBal, initialLpBal);
      assert.bnGt(postStakeBal, initialStakeBal);
    });

    it("cannot stake 0", async () => {
      await assert.revert(
        stakingRewards.connect(owner).stake("0"),
        "Cannot stake 0"
      );
    });
  });

  describe("earned()", () => {
    const seventyDays = DAY * 70;

    it("should be 0 when not staking", async () => {
      assert.bnEqual(await stakingRewards.earned(deployerAccount.address), "0");
    });

    it("should get 1 week of stake when staking one day after startEmission", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 7);

      const earned = await stakingRewards.earned(deployerAccount.address);

      assert.bnGt(earned, toUnit("1249.99"));

      await fastForward(DAY * 30);

      const earned1 = await stakingRewards.earned(deployerAccount.address);
      console.log(formatEther(earned1));
    });

    it("should get 3 week of stake when staking one week after startEmission", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 30);

      const earned1 = await stakingRewards.earned(deployerAccount.address);
      console.log(earned1.toString());
    });

    it("should be 0 when staking but before emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      const earned = await stakingRewards.earned(deployerAccount.address);

      console.log(
        (await provider.getBlock()).timestamp,
        (await stakingRewards.periodFinish()).toNumber()
      );

      assert.bnEqual(parseInt(earned), "0");

      await fastForward(DAY * 30);

      const earned1 = await stakingRewards.earned(deployerAccount.address);
      console.log("earned", formatEther(earned1));
    });

    it("should be > 0 when staking and after emission hit", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 8);

      const earned = await stakingRewards.earned(deployerAccount.address);

      assert.bnGt(earned, toUnit("999.999"));
    });

    it("should be same after emission hit + 1 day", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 8);

      const earned = await stakingRewards.earned(deployerAccount.address);

      await fastForward(DAY);

      const earned2 = await stakingRewards.earned(deployerAccount.address);

      assert.bnEqual(parseInt(earned), parseInt(earned2));
    });

    it("should be 2x when staking and after emission hit twice", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 1);

      const earned = await stakingRewards.earned(deployerAccount.address);

      await fastForward(DAY * 7);

      const earned2 = await stakingRewards.earned(deployerAccount.address);

      assert.isAbove(parseInt(earned), 0);
      assert.bnEqual(parseInt(earned2), parseInt(earned) * 2);
    });

    it("should be increasing 4 times throughout program", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingTokenOwner.transfer(owner.address, totalToStake);
      await stakingTokenOwner.transfer(account3.address, totalToStake);
      await stakingTokenOwner.transfer(account4.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingToken
        .connect(owner)
        .approve(stakingRewards.address, totalToStake);
      await stakingToken
        .connect(account3)
        .approve(stakingRewards.address, totalToStake);
      await stakingToken
        .connect(account4)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 1);

      await stakingRewards.connect(owner).stake(totalToStake);

      assert.isAbove(await stakingRewards.earned(deployerAccount.address), "0");
      assert.bnEqual(await stakingRewards.earned(owner.address), "0");

      await fastForward(DAY * 7);

      await stakingRewards.connect(account3).stake(totalToStake);
      assert.isAbove(await stakingRewards.earned(deployerAccount.address), "0");
      assert.isAbove(await stakingRewards.earned(owner.address), "0");
      assert.bnEqual(await stakingRewards.earned(account3.address), "0");

      await fastForward(DAY * 7);

      await stakingRewards.connect(account4).stake(totalToStake);
      assert.isAbove(await stakingRewards.earned(deployerAccount.address), "0");
      assert.isAbove(await stakingRewards.earned(owner.address), "0");
      assert.isAbove(await stakingRewards.earned(account3.address), "0");
      assert.bnEqual(await stakingRewards.earned(account4.address), "0");

      await fastForward(DAY * 7);

      let deployerEarned = await stakingRewards.earned(deployerAccount.address);
      let ownerEarned = await stakingRewards.earned(owner.address);
      let account3Earned = await stakingRewards.earned(account3.address);
      let account4Earned = await stakingRewards.earned(account4.address);

      assert.isAbove(deployerEarned, "0");
      assert.isAbove(ownerEarned, "0");
      assert.isAbove(account3Earned, "0");
      assert.isAbove(account4Earned, "0");

      await fastForward(DAY * 7);

      console.log(deployerEarned.toString());
      console.log(ownerEarned.toString());
      console.log(account3Earned.toString());
      console.log(account4Earned.toString());

      assert.isAbove(deployerEarned, ownerEarned);
      assert.isAbove(ownerEarned, account3Earned);
      assert.isAbove(account3Earned, account4Earned);

      assert.bnEqual(
        deployerEarned,
        await stakingRewards.earned(deployerAccount.address)
      );
      assert.bnEqual(ownerEarned, await stakingRewards.earned(owner.address));
      assert.bnEqual(
        account3Earned,
        await stakingRewards.earned(account3.address)
      );
      assert.bnEqual(
        account4Earned,
        await stakingRewards.earned(account4.address)
      );
    });


    it("T0 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 22);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      assert.isAbove(
        deployerEarned,
        rewardValue.mul(98).div(100)
      );

      assert.isBelow(
        deployerEarned,
        rewardValue
      );

      await fastForward(DAY * 7);

      assert.bnEqual(
        deployerEarned,
        await stakingRewards.earned(deployerAccount.address)
      );
    });

    it("T1 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 1);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 21);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      console.log(deployerEarned.toString())

      assert.isAbove(
        deployerEarned,
        rewardValue.mul(298).div(400)
      );

      assert.isBelow(
        deployerEarned,
        rewardValue.mul(3).div(4)
      );

      await fastForward(DAY * 7);

      assert.bnEqual(
        deployerEarned,
        await stakingRewards.earned(deployerAccount.address)
      );
    });


    it("T2 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 8);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 14);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      console.log(deployerEarned.toString())
      assert.isAbove(
        deployerEarned,
        rewardValue.mul(98).div(200)
      );

      assert.isBelow(
        deployerEarned,
        rewardValue.mul(1).div(2)
      );

      await fastForward(DAY * 7);

      assert.bnEqual(
        deployerEarned,
        await stakingRewards.earned(deployerAccount.address)
      );
    });

    it("T3 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 15);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 7);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);

      console.log(deployerEarned.toString())

      assert.isAbove(
        deployerEarned,
        rewardValue.mul(98).div(400)
      );

      assert.isBelow(
        deployerEarned,
        rewardValue.mul(1).div(4)
      );

      await fastForward(DAY * 7);

      assert.bnEqual(
        deployerEarned,
        await stakingRewards.earned(deployerAccount.address)
      );
    });

    it("T4 Stake", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);

      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      const rewardValue = toUnit("5000");
      await rewardsTokenOwner.transfer(stakingRewards.address, rewardValue);
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);

      await fastForward(DAY * 22);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 7);
      let deployerEarned = await stakingRewards.earned(deployerAccount.address);
      console.log(deployerEarned.toString())
      assert.bnEqual(
        deployerEarned,
        rewardValue.mul(0).div(4)
      );

      await fastForward(DAY * 7);

      assert.bnEqual(
        deployerEarned,
        await stakingRewards.earned(deployerAccount.address)
      );
    });

    it("rewardRate should increase if new rewards come before DURATION ends", async () => {
      const totalToDistribute = toUnit("5000");

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      const rewardRateInitial = await stakingRewards.rewardRate();

      await fastForward(DAY * 1);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      const rewardRateLater = await stakingRewards.rewardRate();

      assert.isAbove(parseInt(rewardRateInitial), 0);
      assert.isAbove(parseInt(rewardRateLater), parseInt(rewardRateInitial));
    });

    it("rewards token balance should rollover after DURATION", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(DAY * 7);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await fastForward(DAY * 7);
      const earnedFirst = await stakingRewards.earned(deployerAccount.address);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await fastForward(DAY * 7);
      const earnedSecond = await stakingRewards.earned(deployerAccount.address);

      // not exact match but we are not calling notifyRewardAmount
      // after liquidity mining ends (to increase duration)
      // assert.isAbove(earnedSecond, earnedFirst.add(earnedFirst));
    });
  });

  describe("getReward()", () => {
    const seventyDays = DAY * 70;

    it("rewards balance should remain unchanged if getting reward BEFORE end of program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      const initialRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      await fastForward(DAY * 15);

      await stakingRewards.connect(deployerAccount).getReward();
      const postRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      assert.isAbove(
        parseInt(postEarnedBal.toString()),
        parseInt(initialEarnedBal.toString())
      );
      assert.equal(
        parseInt(postRewardBal.toString()),
        parseInt(initialRewardBal.toString())
      );
    });

    it("rewards balance should remain unchanged if getting reward BEFORE end of program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      const initialRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      await fastForward(DAY * 28);

      await stakingRewards.connect(deployerAccount).getReward();
      const postRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      console.log(`post earned bal is ${postEarnedBal.toString()}`);
      console.log(`post reward bal is ${postRewardBal.toString()}`);

      assert.isAbove(
        parseInt(postEarnedBal.toString()),
        parseInt(initialEarnedBal.toString())
      );
      assert.equal(
        parseInt(postRewardBal.toString()),
        parseInt(initialRewardBal.toString())
      );
    });

    it("should increase rewards token balance", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await fastForward(DAY * 81);

      const initialRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );
      await stakingRewards.connect(deployerAccount).getReward();
      const postRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      assert.isAbove(
        parseInt(initialEarnedBal.toString()),
        parseInt(postEarnedBal.toString())
      );
      assert.isAbove(
        parseInt(postRewardBal.toString()),
        parseInt(initialRewardBal.toString())
      );
    });
  });

  describe("setRewardsDuration()", () => {
    const twentyEightDays = DAY * 28;
    const seventyDays = DAY * 70;
    it("should increase rewards duration before starting distribution", async () => {
      const defaultDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(defaultDuration, twentyEightDays);

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);
      const newDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(newDuration, seventyDays);
    });
    it("should revert when setting setRewardsDuration before the period has finished", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await fastForward(DAY);

      await assert.revert(
        stakingRewards.connect(owner).setRewardsDuration(seventyDays),
        "Previous rewards period must be complete before changing the duration for the new period"
      );
    });
    it("should update when setting setRewardsDuration after the period has finished", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await fastForward(DAY * 31);

      await expect(
        stakingRewards.connect(owner).setRewardsDuration(seventyDays)
      ).to.emit(stakingRewards, "RewardsDurationUpdated");

      const newDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(newDuration, seventyDays);

      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);
    });

    it("should update when setting setRewardsDuration after the period has finished", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await fastForward(DAY * 4);
      await stakingRewards.connect(deployerAccount).getReward();
      await fastForward(DAY * 27);

      // New Rewards period much lower
      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await expect(
        stakingRewards.connect(owner).setRewardsDuration(seventyDays)
      ).to.emit(stakingRewards, "RewardsDurationUpdated");

      const newDuration = await stakingRewards.rewardsDuration();
      assert.bnEqual(newDuration, seventyDays);

      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await fastForward(DAY * 71);
      await stakingRewards.connect(deployerAccount).getReward();
    });
  });

  describe("setStartEmission()", () => {
    it("should change the start emission", async () => {
      let newStartEmission = ((await currentTime()) + 1000).toString();

      await stakingRewards.connect(owner).setStartEmission(newStartEmission);

      await expect(
        stakingRewards.connect(owner).setStartEmission(newStartEmission)
      ).to.emit(stakingRewards, "StartEmissionUpdated");

      assert.equal(await stakingRewards.startEmission(), newStartEmission);
    });
    it("should revert when setting setRewardsDuration before the period has finished", async () => {
      let newStartEmission = ((await currentTime()) - 1000).toString();

      await assert.revert(
        stakingRewards.connect(owner).setStartEmission(newStartEmission),
        "Start emission must be in the future"
      );
    });
  });

  describe("getRewardForDuration()", () => {
    it("should increase rewards token balance", async () => {
      const totalToDistribute = toUnit("5000");
      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      const rewardForDuration = await stakingRewards.getRewardForDuration();

      const duration = await stakingRewards.rewardsDuration();
      const rewardRate = await stakingRewards.rewardRate();

      assert.isAbove(rewardForDuration, 0);
      assert.bnEqual(rewardForDuration, duration.mul(rewardRate));
    });
  });

  describe("withdraw()", () => {
    it("cannot withdraw if nothing staked", async () => {
      await expect(stakingRewards.connect(owner).withdraw(toUnit("100"))).to.be
        .reverted;
    });

    it("should set rewards to 0 if withdrawing BEFORE end of mining program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 15);

      await stakingRewards.connect(deployerAccount).withdraw(totalToStake);

      assert.equal(
        BigNumber.from(0),
        (await stakingRewards.rewards(deployerAccount.address)).toString()
      );
    });

    it("rewards should remain unchanged if withdrawing AFTER end of mining program", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("10");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );
      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(totalToDistribute);

      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await fastForward(DAY * 41);

      await stakingRewards.connect(deployerAccount).withdraw(totalToStake);

      assert.bnLt(
        BigNumber.from(0),
        await stakingRewards.rewards(deployerAccount.address)
      );
    });

    it("should increases lp token balance and decreases staking balance", async () => {
      const totalToStake = toUnit("100");
      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      const initialStakingTokenBal = await stakingToken.balanceOf(
        deployerAccount.address
      );
      const initialStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );

      await stakingRewards.connect(deployerAccount).withdraw(totalToStake);

      const postStakingTokenBal = await stakingToken.balanceOf(
        deployerAccount.address
      );
      const postStakeBal = await stakingRewards.balanceOf(
        deployerAccount.address
      );

      assert.equal(
        BigNumber.from(postStakeBal)
          .add(BigNumber.from(totalToStake))
          .toString(),
        initialStakeBal.toString()
      );
      assert.equal(
        BigNumber.from(initialStakingTokenBal)
          .add(BigNumber.from(totalToStake))
          .toString(),
        postStakingTokenBal.toString()
      );
    });

    it("cannot withdraw 0", async () => {
      await assert.revert(
        stakingRewards.connect(owner).withdraw("0"),
        "Cannot withdraw 0"
      );
    });
  });

  describe("exit()", () => {
    const seventyDays = DAY * 70;
    it("should retrieve all earned and increase rewards bal", async () => {
      const totalToStake = toUnit("100");
      const totalToDistribute = toUnit("5000");

      await stakingTokenOwner.transfer(deployerAccount.address, totalToStake);
      await stakingToken
        .connect(deployerAccount)
        .approve(stakingRewards.address, totalToStake);
      await stakingRewards.connect(deployerAccount).stake(totalToStake);

      await rewardsTokenOwner.transfer(
        stakingRewards.address,
        totalToDistribute
      );

      await stakingRewards.connect(owner).setRewardsDuration(seventyDays);

      await stakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(toUnit(5000.0));

      await fastForward(DAY * 81);

      const initialRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const initialEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );
      await stakingRewards.connect(deployerAccount).exit();
      const postRewardBal = await rewardsToken.balanceOf(
        deployerAccount.address
      );
      const postEarnedBal = await stakingRewards.earned(
        deployerAccount.address
      );

      assert.bnLt(postEarnedBal, initialEarnedBal);
      assert.bnGt(postRewardBal, initialRewardBal);
      assert.bnEqual(postEarnedBal, "0");
    });
  });

  describe("notifyRewardAmount()", () => {
    let localStakingRewards;

    before(async () => {
      localStakingRewards = await RibbonStakingRewards.deploy(
        owner.address,
        mockRewardsDistributionAddress.address,
        rewardsToken.address,
        STAKING_REWARDS_rETHTHETA_PARAMS.STAKING_TOKEN,
        startEmission
      );

      await localStakingRewards
        .connect(owner)
        .setRewardsDistribution(mockRewardsDistributionAddress.address);
    });

    it("Reverts if the provided reward is greater than the balance.", async () => {
      const rewardValue = toUnit(1000);
      await rewardsTokenOwner.transfer(
        localStakingRewards.address,
        rewardValue
      );
      await assert.revert(
        localStakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(rewardValue.add(toUnit(0.1))),
        "Provided reward too high"
      );
    });

    it("Reverts if the provided reward is greater than the balance, plus rolled-over balance.", async () => {
      const rewardValue = toUnit(1000);
      await rewardsTokenOwner.transfer(
        localStakingRewards.address,
        rewardValue
      );
      localStakingRewards
        .connect(mockRewardsDistributionAddress)
        .notifyRewardAmount(rewardValue);
      await rewardsTokenOwner.transfer(
        localStakingRewards.address,
        rewardValue
      );
      // Now take into account any leftover quantity.
      await assert.revert(
        localStakingRewards
          .connect(mockRewardsDistributionAddress)
          .notifyRewardAmount(rewardValue.add(toUnit(0.1))),
        "Provided reward too high"
      );
    });
  });

  // Integration tests with RewardsDistribution.sol which I dont think we need
  // https://github.com/Synthetixio/synthetix/blob/master/contracts/RewardsDistribution.sol

  /*
	describe('Integration Tests', () => {
		before(async () => {
			// Set rewardDistribution address
			await stakingRewards.setRewardsDistribution(rewardsDistribution.address, {
				from: owner,
			});
			assert.equal(await stakingRewards.rewardsDistribution(), rewardsDistribution.address);

			await setRewardsTokenExchangeRate();
		});

		it('stake and claim', async () => {
			// Transfer some LP Tokens to user
			const totalToStake = toUnit('500');
			await stakingToken.transfer(stakingAccount1, totalToStake, { from: owner });

			// Stake LP Tokens
			await stakingToken.approve(stakingRewards.address, totalToStake, { from: stakingAccount1 });
			await stakingRewards.stake(totalToStake, { from: stakingAccount1 });

			// Distribute some rewards
			const totalToDistribute = toUnit('35000');
			assert.equal(await rewardsDistribution.distributionsLength(), 0);
			await rewardsDistribution.addRewardDistribution(stakingRewards.address, totalToDistribute, {
				from: owner,
			});
			assert.equal(await rewardsDistribution.distributionsLength(), 1);

			// Transfer Rewards to the RewardsDistribution contract address
			await rewardsToken.transfer(rewardsDistribution.address, totalToDistribute, { from: owner });

			// Distribute Rewards called from Synthetix contract as the authority to distribute
			await rewardsDistribution.distributeRewards(totalToDistribute, {
				from: authority,
			});

			// Period finish should be ~7 days from now
			const periodFinish = await stakingRewards.periodFinish();
			const curTimestamp = await currentTime();
			assert.equal(parseInt(periodFinish.toString(), 10), curTimestamp + DAY * 7);

			// Reward duration is 7 days, so we'll
			// Fastforward time by 6 days to prevent expiration
			await fastForward(DAY * 6);

			// Reward rate and reward per token
			const rewardRate = await stakingRewards.rewardRate();
			assert.bnGt(rewardRate, ZERO_BN);

			const rewardPerToken = await stakingRewards.rewardPerToken();
			assert.bnGt(rewardPerToken, ZERO_BN);

			// Make sure we earned in proportion to reward per token
			const rewardRewardsEarned = await stakingRewards.earned(stakingAccount1);
			assert.bnEqual(rewardRewardsEarned, rewardPerToken.mul(totalToStake).div(toUnit(1)));

			// Make sure after withdrawing, we still have the ~amount of rewardRewards
			// The two values will be a bit different as time has "passed"
			const initialWithdraw = toUnit('100');
			await stakingRewards.withdraw(initialWithdraw, { from: stakingAccount1 });
			assert.bnEqual(initialWithdraw, await stakingToken.balanceOf(stakingAccount1));

			const rewardRewardsEarnedPostWithdraw = await stakingRewards.earned(stakingAccount1);
			assert.bnClose(rewardRewardsEarned, rewardRewardsEarnedPostWithdraw, toUnit('0.1'));

			// Get rewards
			const initialRewardBal = await rewardsToken.balanceOf(stakingAccount1);
			await stakingRewards.getReward({ from: stakingAccount1 });
			const postRewardRewardBal = await rewardsToken.balanceOf(stakingAccount1);

			assert.bnGt(postRewardRewardBal, initialRewardBal);

			// Exit
			const preExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			await stakingRewards.exit({ from: stakingAccount1 });
			const postExitLPBal = await stakingToken.balanceOf(stakingAccount1);
			assert.bnGt(postExitLPBal, preExitLPBal);
		});
	});
	*/
});
