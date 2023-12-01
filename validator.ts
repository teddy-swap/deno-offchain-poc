import { Assets, Constr, Credential, Data, Lucid, OutRef, Script, ScriptType, UTxO, fromText } from "https://deno.land/x/lucid@0.10.7/mod.ts"
import { MAX_LP_CAP } from "./constants.ts";
import { AssetClassType, PoolDatum, SwapDatum } from "./datum.ts";

import poolValidator from "./scripts/pool.json" with { type: "json" };
import swapValidator from "./scripts/swap.json" with { type: "json" };
import depositValidator from "./scripts/deposit.json" with { type: "json" };
import redeemValidator from "./scripts/redeem.json" with { type: "json" };
import { config } from "https://deno.land/x/dotenv@v3.2.2/mod.ts";

export const poolValidatorScript = {
    type: "PlutusV2" as ScriptType,
    script: poolValidator.cborHex,
};

export const swapValidatorScript = {
    type: "PlutusV2" as ScriptType,
    script: swapValidator.cborHex,
};

export const depositValidatorScript = {
    type: "PlutusV2" as ScriptType,
    script: depositValidator.cborHex,
};

export const redeemValidatorScript = {
    type: "PlutusV2" as ScriptType,
    script: redeemValidator.cborHex,
};

export type PoolTokenSet = { [key: string]: bigint };

export const poolValidatorAddress = (lucid: Lucid, stakingCreds: Credential) => {
    const validatorAddr = lucid.utils.validatorToAddress(poolValidatorScript);
    const validatorAddrDetails = lucid.utils.getAddressDetails(validatorAddr);
    return lucid.utils.credentialToAddress(validatorAddrDetails.paymentCredential!, stakingCreds);
};

export const swapValidatorAddress = (lucid: Lucid, stakingCreds: Credential) => {
    const validatorAddr = lucid.utils.validatorToAddress(swapValidatorScript);
    const validatorAddrDetails = lucid.utils.getAddressDetails(validatorAddr);
    return lucid.utils.credentialToAddress(validatorAddrDetails.paymentCredential!, stakingCreds);
};

export const depositValidatorAddress = (lucid: Lucid, stakingCreds: Credential) => {
    const validatorAddr = lucid.utils.validatorToAddress(depositValidatorScript);
    const validatorAddrDetails = lucid.utils.getAddressDetails(validatorAddr);
    return lucid.utils.credentialToAddress(validatorAddrDetails.paymentCredential!, stakingCreds);
};

export const redeemValidatorAddress = (lucid: Lucid, stakingCreds: Credential) => {
    const validatorAddr = lucid.utils.validatorToAddress(redeemValidatorScript);
    const validatorAddrDetails = lucid.utils.getAddressDetails(validatorAddr);
    return lucid.utils.credentialToAddress(validatorAddrDetails.paymentCredential!, stakingCreds);
};

export const createPoolAsync = async (
    lucid: Lucid,
    poolTokenSet: PoolTokenSet,
    rewardAddr: string,
    poolAddr: string,
    stakeAdminPolicyId: string,
    tokenAmountXInPool: bigint,
    tokenAmountYInPool: bigint,
    baseAsset: [string, string] = ["", ""]
) => {
    const lqInPool = 1000n;

    const utxos = await lucid.wallet.getUtxos();
    const rewardAssets: Assets = {};
    const tx = lucid.newTx()
        .collectFrom(utxos);

    const extractedTokenSet = extractTokenInfo(poolTokenSet);

    console.log({ extractedTokenSet });

    const poolDatum: PoolDatum = {
        poolNft: [extractedTokenSet.identity.policyId, fromText(extractedTokenSet.identity.tokenName)],
        poolX: baseAsset,
        poolY: [extractedTokenSet.native.policyId, fromText(extractedTokenSet.native.tokenName)],
        poolLq: [extractedTokenSet.lp.policyId, fromText(extractedTokenSet.lp.tokenName)],
        feeNum: 997n,
        stakeAdminPolicy: [stakeAdminPolicyId],
        lqBound: 0n
    };

    console.log("Pool Datum", poolDatum);

    console.log("Pool Datum Cbor", Data.to<PoolDatum>(poolDatum, PoolDatum));

    const poolAssets: Assets = baseAsset[0] !== "" ? {
        ["lovelace"]: 4000000n,
        [baseAsset.join("")]: tokenAmountXInPool,
        [poolDatum.poolY.join("")]: tokenAmountYInPool,
        [poolDatum.poolNft.join("")]: 1n,
        [poolDatum.poolLq.join("")]: MAX_LP_CAP - lqInPool,
    } : {
        ["lovelace"]: tokenAmountXInPool,
        [poolDatum.poolY.join("")]: tokenAmountYInPool,
        [poolDatum.poolNft.join("")]: 1n,
        [poolDatum.poolLq.join("")]: MAX_LP_CAP - lqInPool,
    };

    console.log("Pool Assets", poolAssets);
    console.log("Pool Address", poolAddr);

    tx.payToContract(poolAddr, {
        inline: Data.to<PoolDatum>(poolDatum, PoolDatum),
    }, poolAssets);

    rewardAssets[poolDatum.poolLq.join("").toLowerCase()] = lqInPool;
    tx.payToAddress(rewardAddr, rewardAssets);

    console.log({ rewardAssets });
    const finalTx = await tx.complete(
        { change: { address: rewardAddr } },
    );

    const signedTx = await finalTx.sign().complete();
    const txHash = await signedTx.submit();

    console.log("Tx Hash", txHash);

    await lucid.awaitTx(txHash);

    console.log("Create Pool Confirmed", txHash);

    return txHash;
};

const createSwapDatum = (
    baseAsset: [string, string],
    quoteAsset: [string, string],
    poolDatum: PoolDatum,
    exFeePerTokenNum: bigint,
    exFeePerTokenDen: bigint,
    rewardPkh: string,
    stakePkh: string | null,
    baseAmount: bigint,
    minQuoteAmount: bigint
): SwapDatum => ({
    base: baseAsset,
    quote: quoteAsset,
    poolNft: poolDatum.poolNft,
    feeNum: poolDatum.feeNum,
    exFeePerTokenNum,
    exFeePerTokenDen,
    rewardPkh,
    stakePkh,
    baseAmount,
    minQuoteAmount,
});

export const createSwapOrder = (
    baseIsAda: boolean,
    baseAmount: bigint,
    collateralAda: bigint,
    minExFee: bigint,
    slippage: bigint,
    poolDatum: PoolDatum,
    poolValue: Assets,
    rewardPkh: string,
    stakePkh: string | null,
    baseAsset: [string, string],
): [SwapDatum, bigint] => {
    const feeDen = 1000n;
    const exFeePerTokenDen = 1000000000000000n;

    const baseAssetStr = baseIsAda ? "lovelace" : baseAsset[0].concat(baseAsset[1]).toLowerCase();
    const quoteAssetStr = baseIsAda ? poolDatum.poolY[0].concat(poolDatum.poolY[1]).toLowerCase() : "lovelace";
    const reservesBase = poolValue[baseAssetStr];
    const reservesQuote = poolValue[quoteAssetStr];

    const correctOutput = calculateCorrectOutput(
        baseAmount,
        reservesBase,
        reservesQuote,
        poolDatum.feeNum,
        feeDen,
    );
    const slippageFactor = BigInt(100) - slippage;
    const minQuoteAmount = (correctOutput * slippageFactor) / BigInt(100);
    const exFeePerTokenNum = (minExFee * exFeePerTokenDen) / minQuoteAmount;

    const swapDatum = createSwapDatum(
        baseAsset,
        [poolDatum.poolY[0], poolDatum.poolY[1]],
        poolDatum,
        exFeePerTokenNum,
        exFeePerTokenDen,
        rewardPkh,
        stakePkh,
        baseAmount,
        minQuoteAmount
    );

    const minAda = baseIsAda ? baseAmount + minExFee + collateralAda : minExFee + collateralAda;

    return [swapDatum, minAda];
};

/*
AMM Formula
output = (input * reserves_quote * fee_num) / (reserves_base * fee_den + input * fee_num)
*/
export const calculateCorrectOutput = (
    baseAmount: bigint,
    reservesBase: bigint,
    reservesQuote: bigint,
    feeNum: bigint,
    feeDen: bigint,
) => {
    const numerator = reservesQuote * baseAmount * feeNum;
    const denominator = reservesBase * feeDen + baseAmount * feeNum;
    return numerator / denominator;
};

export type TokenInfo = { policyId: string, tokenName: string };

export const extractTokenInfo = (poolTokenSet: PoolTokenSet): { lp: TokenInfo, identity: TokenInfo, native: TokenInfo } => {
    const tokens = Object.keys(poolTokenSet);
    const [lpPolicyId, lpTokenName] = tokens[0].split(".");
    const [identityPolicyId, identityTokenName] = tokens[1].split(".");
    const [nativePolicyId, nativeTokenName] = tokens[2].split(".");
    return {
        lp: { policyId: lpPolicyId, tokenName: lpTokenName },
        identity: { policyId: identityPolicyId, tokenName: identityTokenName },
        native: { policyId: nativePolicyId, tokenName: nativeTokenName },
    };
}

export const findPoolData = async (
    lucid: Lucid,
    poolAddr: string,
    poolNft: string,
    poolOutRef: OutRef,
): Promise<[UTxO, UTxO, PoolDatum | null]> => {
    const poolVRefScriptUtxo = await lucid.provider.getUtxosByOutRef([
        poolOutRef,
    ]);
    const poolUtxo = await findPoolUtxo(poolAddr, poolNft.toLowerCase(), lucid);
    let poolDatum = null;
    try {
        poolDatum = Data.from<PoolDatum>(poolUtxo.datum || "", PoolDatum);
    } catch (err) {
        console.log("pool utxo not found", poolAddr, poolNft.toLowerCase(), err);
    }
    return [poolVRefScriptUtxo[0], poolUtxo, poolDatum];
};

export const findPoolUtxo = async (
    poolAddr: string,
    unit: string,
    lucid: Lucid,
): Promise<UTxO> => {
    const env = config();
    const rawUtxosReq = await fetch(`${env['API_ENDPOINT']}/addresses/${poolAddr}/utxos`, {
        headers: {
            'project_id': env['BLOCKFROST_API_KEY']
        }
    });
    const rawUtxos = await rawUtxosReq.json();
    console.log("Raw Utxos", rawUtxos);

    // Find the first UTXO that contains the specified unit
    const poolRawUtxo = rawUtxos.find((utxo: any) => utxo.amount.some((v: any) => {
        const fullUnit = v.unit.startsWith('lovelace') ? 'lovelace' : v.unit;
        return unit === fullUnit;
    }));

    const assets = {} as any;

    if (poolRawUtxo) {
        poolRawUtxo.amount.forEach((v: any) => {
            const assetUnit = v.unit.startsWith('lovelace') ? 'lovelace' : v.unit;
            const quantity = BigInt(v.quantity);

            // Aggregate the quantities of each asset
            if (assets[assetUnit]) {
                assets[assetUnit] += quantity;
            } else {
                assets[assetUnit] = quantity;
            }
        });

        return {
            txHash: poolRawUtxo.tx_hash,
            outputIndex: poolRawUtxo.output_index,
            address: poolRawUtxo.address,
            datum: poolRawUtxo.inline_datum ? poolRawUtxo.inline_datum : null,
            assets
        } as UTxO;
    } else {
        throw new Error('No UTXO found for the given unit.');
    }
};

export const createScriptReferenceAsync = async (lucid: Lucid, validatorScript: Script, stakeCredential: Credential) => {
    const scriptAddr = lucid.utils.validatorToAddress(validatorScript, stakeCredential);
    console.log("Creating Script Reference", scriptAddr);

    const tx = await lucid.newTx()
        .payToContract(scriptAddr, {
            asHash: Data.void(),
            scriptRef: validatorScript,
        }, {})
        .complete();
    const signedTx = await tx.sign().complete();
    const txHash = await signedTx.submit();

    console.log("Created Script Reference, waiting for confirmation: ", txHash);

    await lucid.awaitTx(txHash);
    return { txHash, outputIndex: 0, address: scriptAddr } as UTxO;
}

export const submitSwapOrderAsync = async (
    swapDatum: SwapDatum,
    minAda: bigint,
    swapAddr: string,
    lucid: Lucid,
    waitTx = true,
) => {
    const swapAssets: Assets = {
        "lovelace": minAda,
    };

    const baseIsAda = swapDatum.base[0] === "";

    if (!baseIsAda) {
        swapAssets[swapDatum.base[0] + swapDatum.base[1]] = swapDatum.baseAmount;
    }

    console.log("SwapDatum", swapDatum);

    console.log("SwapAssets", swapAssets);

    const utxos = await lucid.wallet.getUtxos();
    console.log("SwapDatum Cbor", Data.to<SwapDatum>(swapDatum, SwapDatum))
    const tx = await lucid.newTx()
        .collectFrom(utxos)
        .payToContract(swapAddr, {
            inline: Data.to<SwapDatum>(swapDatum, SwapDatum),
        }, swapAssets)
        .complete();

    const signedTx = await tx.sign().complete();
    const txHash = await signedTx.submit();

    if (waitTx)
        await lucid.awaitTx(txHash);

    return txHash;
};

export const executeSwapOrderAsync = async (
    lucid: Lucid,
    poolAddr: string,
    poolUtxo: UTxO,
    poolDatum: PoolDatum,
    swapUtxo: UTxO,
    poolRefScriptUtxo: UTxO,
    swapRefScriptUtxo: UTxO,
    rewardAddress: string,
    changeAddress: string,
    isRefund: boolean,
): Promise<
    [
        string,
        {
            poolOutRef: OutRef;
            nft: AssetClassType;
            reserveX: bigint;
            reserveY: bigint;
        },
    ]
> => {
    const noAdaPair = poolDatum.poolX[0] !== "" && poolDatum.poolY[0] !== "";
    console.log({ noAdaPair });

    if (!noAdaPair) {
        const swapDatum = Data.from<SwapDatum>(swapUtxo.datum!, SwapDatum);
        const baseIsAda = swapDatum.base[0] === "";
        console.log({ baseIsAda });
        const reservesBase = baseIsAda
            ? poolUtxo.assets["lovelace"]
            : poolUtxo.assets[`${swapDatum.base[0] + swapDatum.base[1]}`];
        const reservesQuote = baseIsAda
            ? poolUtxo.assets[`${swapDatum.quote[0] + swapDatum.quote[1]}`]
            : poolUtxo.assets["lovelace"];
        console.log({ reservesBase, reservesQuote });
        const correctOutput = calculateCorrectOutput(
            swapDatum.baseAmount,
            reservesBase,
            reservesQuote,
            poolDatum.feeNum,
            1000n,
        );
        const poolLq = poolDatum.poolLq[0] + poolDatum.poolLq[1];
        const poolNft = poolDatum.poolNft[0] + poolDatum.poolNft[1];
        const poolY = poolDatum.poolY[0] + poolDatum.poolY[1];
        const roundedCorrectOutput = correctOutput;

        console.log({ correctOutput, roundedCorrectOutput });
        console.log("test", `${poolY}`, poolUtxo.assets[`${poolY}`], poolUtxo.assets);
        const poolYPoolAssetValue = isRefund
            ? poolUtxo.assets[`${poolY}`]
            : baseIsAda
                ? poolUtxo.assets[`${poolY}`] - roundedCorrectOutput
                : poolUtxo.assets[`${poolY}`] + swapDatum.baseAmount;
        const poolXPoolAssetValue = isRefund
            ? poolUtxo.assets["lovelace"]
            : baseIsAda
                ? poolUtxo.assets["lovelace"] + swapDatum.baseAmount
                : poolUtxo.assets["lovelace"] - roundedCorrectOutput;

        console.log({ poolXPoolAssetValue, poolYPoolAssetValue });
        const poolAssets: Assets = {
            "lovelace": poolXPoolAssetValue,
            [poolNft]: 1n,
            [poolLq]: poolUtxo.assets[`${poolLq}`],
            [poolY]: poolYPoolAssetValue,
        };

        console.log({ poolAssets });

        // console.log({ roundedCorrectOutput });

        const exFee = correctOutput * swapDatum.exFeePerTokenNum / swapDatum.exFeePerTokenDen;
        const baseMinAda = baseIsAda ? swapDatum.baseAmount : 0n;
        const minRewardAda = swapUtxo.assets["lovelace"] - baseMinAda - exFee +
            100n; //
        const rewardAda = baseIsAda
            ? minRewardAda
            : minRewardAda + roundedCorrectOutput;

        console.log({ minRewardAda });

        console.log({ exFee });
        // REWARD OUTPUT
        const rewardAssets: Assets = {
            "lovelace": isRefund ? swapUtxo.assets["lovelace"] - 2000000n : rewardAda,
        };

        if (baseIsAda && !isRefund) {
            rewardAssets[poolY] = roundedCorrectOutput;
        }

        console.log({ rewardAssets });
        console.log("minQuoteAmount", swapDatum.minQuoteAmount);

        if (!baseIsAda && isRefund) {
            rewardAssets[poolY] = swapDatum.baseAmount;
        }

        const swapUtxoStr = swapUtxo.txHash + swapUtxo.outputIndex;
        const poolUtxoStr = poolUtxo.txHash + poolUtxo.outputIndex;

        const order = [swapUtxoStr, poolUtxoStr].sort();
        const poolIndex = order[0] === poolUtxoStr ? 0n : 1n;
        const swapIndex = order[0] === swapUtxoStr ? 0n : 1n;
        const swapAction = isRefund ? 1n : 0n;

        const poolRedeemer: string = Data.to(
            new Constr(0, [2n, poolIndex]),
        );

        const orderRedeemer: string = Data.to(
            new Constr(0, [poolIndex, swapIndex, 1n, swapAction]),
        );
        console.log({ poolAssets, poolRefScriptUtxo, swapRefScriptUtxo });
        // create and submit tx
        const tx = lucid.newTx()
            .readFrom([poolRefScriptUtxo])
            .collectFrom([poolUtxo], poolRedeemer)
            .readFrom([swapRefScriptUtxo])
            .collectFrom([swapUtxo], orderRedeemer)
            .payToContract(poolAddr, {
                inline: Data.to<PoolDatum>(poolDatum, PoolDatum),
            }, poolAssets)
            .payToAddress(rewardAddress, rewardAssets);

        if (isRefund) {
            tx.addSigner(rewardAddress);
        }
        const finalTx = await tx.complete({
            change: {
                address: changeAddress,
            },
            coinSelection: false,
            nativeUplc: false,
        });
        const signedTx = await finalTx.sign().complete();
        console.log("Submitting Execute Swap Order");
        const txHash = await signedTx.submit();
        console.log("Tx Hash", txHash);
        await lucid.awaitTx(txHash);
        console.log("Execute Swap Order Confirmed", txHash);

        const newPoolState: {
            poolOutRef: OutRef;
            nft: AssetClassType;
            reserveX: bigint;
            reserveY: bigint;
        } = {
            poolOutRef: {
                txHash: txHash,
                outputIndex: 0,
            },
            nft: [poolDatum.poolNft[0], poolDatum.poolNft[1]],
            reserveX: poolYPoolAssetValue,
            reserveY: poolYPoolAssetValue,
        };

        return [txHash, newPoolState];
    } else {
        const swapDatum = Data.from<SwapDatum>(swapUtxo.datum || "", SwapDatum);
        const reservesBase =
            poolUtxo.assets[`${swapDatum.base[0] + swapDatum.base[1]}`];
        const reservesQuote =
            poolUtxo.assets[`${swapDatum.quote[0] + swapDatum.quote[1]}`];
        // console.log({ reservesBase, reservesQuote });
        const correctOutput = calculateCorrectOutput(
            swapDatum.baseAmount,
            reservesBase,
            reservesQuote,
            poolDatum.feeNum,
            1000n,
        );
        const poolLq = poolDatum.poolLq[0] + poolDatum.poolLq[1];
        const poolNft = poolDatum.poolNft[0] + poolDatum.poolNft[1];
        const poolX = poolDatum.poolX[0] + poolDatum.poolX[1];
        const poolY = poolDatum.poolY[0] + poolDatum.poolY[1];

        const baseIsPoolX = poolX.toLowerCase() ===
            swapDatum.base[0].concat(swapDatum.base[1]).toLowerCase();
        const roundedCorrectOutput = correctOutput;

        // console.log({ correctOutput, roundedCorrectOutput });

        const poolXPoolAssetValue = isRefund
            ? poolUtxo.assets[poolX]
            : baseIsPoolX
                ? poolUtxo.assets[poolX] + swapDatum.baseAmount
                : poolUtxo.assets[poolX] - roundedCorrectOutput;
        const poolYPoolAssetValue = isRefund
            ? poolUtxo.assets[poolY]
            : baseIsPoolX
                ? poolUtxo.assets[poolY] - roundedCorrectOutput
                : poolUtxo.assets[poolY] + swapDatum.baseAmount;
        const remainingAda = poolUtxo.assets["lovelace"];

        // console.log({ poolXPoolAssetValue, poolYPoolAssetValue });
        const poolAssets: Assets = {
            "lovelace": remainingAda,
            [poolNft]: 1n,
            [poolLq]: poolUtxo.assets[`${poolLq}`],
            [poolX]: poolXPoolAssetValue,
            [poolY]: poolYPoolAssetValue,
        };

        // console.log({ roundedCorrectOutput }); 
        const exFee = correctOutput * swapDatum.exFeePerTokenNum / swapDatum.exFeePerTokenDen;
        const minRewardAda = swapUtxo.assets["lovelace"] - exFee + 100000n; //

        // console.log({ minRewardAda });

        // console.log({ exFee });
        // REWARD OUTPUT
        const rewardAssets: Assets = {
            "lovelace": isRefund
                ? swapUtxo.assets["lovelace"] - 2000000n
                : minRewardAda,
        };

        if (isRefund) {
            rewardAssets[swapDatum.base[0].concat(swapDatum.base[1])] =
                swapDatum.baseAmount;
        } else {
            rewardAssets[swapDatum.quote[0].concat(swapDatum.quote[1])] =
                roundedCorrectOutput;
        }

        // console.log({ rewardAssets });

        const swapUtxoStr = swapUtxo.txHash + swapUtxo.outputIndex;
        const poolUtxoStr = poolUtxo.txHash + poolUtxo.outputIndex;

        const order = [swapUtxoStr, poolUtxoStr].sort();
        const poolIndex = order[0] === poolUtxoStr ? 0n : 1n;
        const swapIndex = order[0] === swapUtxoStr ? 0n : 1n;
        const swapAction = isRefund ? 1n : 0n;

        const poolRedeemer: string = Data.to(
            new Constr(0, [2n, poolIndex]),
        );

        const orderRedeemer: string = Data.to(
            new Constr(0, [poolIndex, swapIndex, 1n, swapAction]),
        );

        // create and submit tx
        const tx = lucid.newTx()
            .readFrom([poolRefScriptUtxo])
            .collectFrom([poolUtxo], poolRedeemer)
            .readFrom([swapRefScriptUtxo])
            .collectFrom([swapUtxo], orderRedeemer)
            .payToContract(poolAddr, {
                inline: Data.to<PoolDatum>(poolDatum, PoolDatum),
            }, poolAssets)
            .payToAddress(rewardAddress, rewardAssets);

        if (isRefund) {
            tx.addSigner(rewardAddress);
        }

        const finalTx = await tx.complete({
            change: {
                address: changeAddress,
            },
            coinSelection: false,
            nativeUplc: false,
        });

        const signedTx = await finalTx.sign().complete();
        console.log("Submitting Execute Swap Order", signedTx.toString());
        const txHash = await signedTx.submit();

        await lucid.awaitTx(txHash);
        console.log("Execute Swap Order Confirmed", txHash);

        const newPoolState: {
            poolOutRef: OutRef;
            nft: AssetClassType;
            reserveX: bigint;
            reserveY: bigint;
        } = {
            poolOutRef: {
                txHash: txHash,
                outputIndex: 0,
            },
            nft: [poolDatum.poolNft[0], poolDatum.poolNft[1]],
            reserveX: poolXPoolAssetValue,
            reserveY: poolYPoolAssetValue,
        };

        return [txHash, newPoolState];
    }
};

export const refundSwapOrderAsync = async (lucid: Lucid, swapOrderUtxo: UTxO, swapRefScriptUtxo: UTxO, refundAddress: string) => {
    const redemeer = Data.to(new Constr(0, [0n, 0n, 0n, 1n]));
    const tx = await lucid
        .newTx()
        .readFrom([swapRefScriptUtxo])
        .collectFrom([swapOrderUtxo], redemeer)
        .addSigner(refundAddress)
        .complete({
            nativeUplc: false
        });

    const signedTx = await tx.sign().complete();

    const txHash = await signedTx.submit();
    console.log("Refund Swap Order Submitted", txHash);
    await lucid.awaitTx(txHash);
    console.log("Refund Swap Order Confirmed", txHash);
};

/*
*
data PoolRedeemer = PoolRedeemer
    { action :: PoolAction
    , selfIx :: Integer
    }
    deriving (Haskell.Show, Eq, Haskell.Generic)
*/
export const attemptHackPoolAsync = async (lucid: Lucid, poolRefScriptUtxo: UTxO, poolUtxo: UTxO, policy_id: string) => {
    const redemeer = Data.to(new Constr(0, [4n, 0n]));
    const tx = await lucid
        .newTx()
        .readFrom([poolRefScriptUtxo])
        .collectFrom([poolUtxo], redemeer)
        .mintAssets({ [`${policy_id}746e`]: 1n })
        .complete({
            nativeUplc: true,
            coinSelection: false
        });

    const signedTx = await tx.sign().complete();

    const txHash = await signedTx.submit();
    console.log("Hack Order Submitted", txHash);
    await lucid.awaitTx(txHash);
    console.log("Hack Order Confirmed", txHash);
};

export const sendTokenAsync = async (lucid: Lucid, unit: string, amount: bigint, toAddress: string) => {
    const utxos = await lucid.wallet.getUtxos();
    console.log("Send Token Utxos", utxos);
    const tx = await lucid.newTx()
        .payToAddress(toAddress, { [unit]: amount })
        .complete();

    const signedTx = await tx.sign().complete();
    const txHash = await signedTx.submit();
    console.log("Send Token Submitted", txHash);
    await lucid.awaitTx(txHash);
    console.log("Send Token Confirmed", txHash);
}

export const mintTokenAsync = async (lucid: Lucid, mintPolicy: Script, unit: string, amount: bigint) => {
    const tx = await lucid.newTx()
        .mintAssets({ [unit]: amount })
        .validTo(Date.now() + 200000)
        .attachMintingPolicy(mintPolicy)
        .complete();

    const signedTx = await tx.sign().complete();

    const txHash = await signedTx.submit();
    console.log("Mint Token Submitted", txHash);
    await lucid.awaitTx(txHash);
    console.log("Mint Token Confirmed", txHash);
    return txHash;
}