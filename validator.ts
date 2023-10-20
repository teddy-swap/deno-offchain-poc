import { Assets, Data, Lucid, ScriptType, fromText } from "https://deno.land/x/lucid@0.10.7/mod.ts"
import { MAX_LP_CAP } from "./constants.ts";
import { MintData, PoolDatum } from "./datum.ts";
import depositValidatorJson from "./scripts/deposit.json" with { type: "json" };

const depositValidatorScript = {
    type: "PlutusV2" as ScriptType,
    script: depositValidatorJson.cborHex,
};

export type PoolTokenSet = { [key: string]: bigint };

export const depositValidatorAddress = (lucid: Lucid) => lucid.utils.validatorToAddress(depositValidatorScript);

export const createAdaPool = async (
    lucid: Lucid,
    poolTokenSet: PoolTokenSet,
    rewardAddr: string,
    poolAddr: string,
    stakeAdminPolicyId: string,
    waitTx = true,
) => {
    const nativeTokenAmountInPool = 1000000000000n;
    const adaAmountInPool = 1000000000n;

    const utxos = await lucid.wallet.getUtxos();
    const rewardAssets: Assets = {};
    const tx = lucid.newTx()
        .collectFrom(utxos);
    
    const [lpPolicyId, lpTokenName] = Object.keys(poolTokenSet)[0].split(".");
    const [identityPolicyId, identityTokenName] = Object.keys(poolTokenSet)[1].split(".");
    const [nativePolicyId, nativeTokenName] = Object.keys(poolTokenSet)[2].split(".");
        
    const poolDatum: PoolDatum = {
        poolNft: [identityPolicyId, fromText(identityTokenName)],
        poolX: ["", ""],
        poolY: [nativePolicyId, fromText(nativeTokenName)],
        poolLq: [lpPolicyId, fromText(lpTokenName)],
        feeNum: 995n,
        stakeAdminPolicy: [stakeAdminPolicyId],
        lqBound: 0n
    };

    console.log(poolDatum);

    console.log("Pool Datum Cbor", Data.to<PoolDatum>(poolDatum, PoolDatum));
    
    const poolAssets: Assets = {
        ["lovelace"]: adaAmountInPool,
        [poolDatum.poolY.join("")]: nativeTokenAmountInPool,
        [poolDatum.poolNft.join("")]: 1n,
        [poolDatum.poolLq.join("")]: MAX_LP_CAP - nativeTokenAmountInPool,
    };
    
    console.log("Pool Assets", poolAssets);
    console.log("Pool Address", poolAddr);

    tx.payToContract(poolAddr, {
        inline: Data.to<PoolDatum>(poolDatum, PoolDatum),
    }, poolAssets);

    rewardAssets[poolDatum.poolLq.join("").toLowerCase()] = nativeTokenAmountInPool;
    tx.payToAddress(rewardAddr, rewardAssets);
    
    console.log({ rewardAssets });
    const finalTx = await tx.complete(
        { change: { address: rewardAddr } },
    );

    const signedTx = await finalTx.sign().complete();
    const txHash = await signedTx.submit();
    await lucid.awaitTx(txHash);

    return txHash;
};