import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-truffle5";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-web3";
import "@nomiclabs/hardhat-vyper";
import "@nomiclabs/hardhat-ethers";
import "hardhat-contract-sizer";

require("dotenv").config();

process.env.TEST_MNEMONIC =
  "test test test test test test test test test test test junk";

module.exports = {
  accounts: {
    mnemonic: process.env.TEST_MNEMONIC,
  },
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            runs: 9999,
            enabled: true,
          },
        },
      },
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            runs: 9999,
            enabled: true,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.TEST_URI,
        gasLimit: 8e6,
        blockNumber: 12239391,
      },
    },
    kovan: {
      url: process.env.KOVAN_URI,
      accounts: {
        mnemonic: process.env.KOVAN_MNEMONIC,
      },
      // accounts: [`0x${process.env.KOVAN_KEY}`,`0x${process.env.KOVAN_KEY2}`]
    },
    mainnet: {
      url: process.env.MAINNET_URI,
      accounts: {
        mnemonic: process.env.MNEMONIC,
      },
      // accounts: [`0x${process.env.KOVAN_KEY}`,`0x${process.env.KOVAN_KEY2}`]
    },
  },
  mocha: {
    timeout: 200000,
  },
  vyper: {
    version: "0.3.1",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
