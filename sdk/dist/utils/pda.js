"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFifoStatePDA = getFifoStatePDA;
exports.getPoolRegistryPDA = getPoolRegistryPDA;
exports.getPoolAuthorityPDA = getPoolAuthorityPDA;
exports.getOrderPDA = getOrderPDA;
const web3_js_1 = require("@solana/web3.js");
const constants_1 = require("../constants");
function getFifoStatePDA() {
    return web3_js_1.PublicKey.findProgramAddressSync([constants_1.FIFO_STATE_SEED], constants_1.CONTINUUM_PROGRAM_ID);
}
function getPoolRegistryPDA(poolId) {
    return web3_js_1.PublicKey.findProgramAddressSync([constants_1.POOL_REGISTRY_SEED, poolId.toBuffer()], constants_1.CONTINUUM_PROGRAM_ID);
}
function getPoolAuthorityPDA(poolId) {
    return web3_js_1.PublicKey.findProgramAddressSync([constants_1.CP_POOL_AUTHORITY_SEED, poolId.toBuffer()], constants_1.CONTINUUM_PROGRAM_ID);
}
function getOrderPDA(user, sequence) {
    return web3_js_1.PublicKey.findProgramAddressSync([constants_1.ORDER_SEED, user.toBuffer(), sequence.toArrayLike(Buffer, 'le', 8)], constants_1.CONTINUUM_PROGRAM_ID);
}
