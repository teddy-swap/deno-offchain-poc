import { Assets, Constr, Data, Lucid, OutRef, Script, ScriptType, UTxO, fromText } from "https://deno.land/x/lucid@0.10.7/mod.ts"
import { MAX_LP_CAP } from "./constants.ts";
import { AssetClassType, PoolDatum, SwapDatum } from "./datum.ts";

import poolValidator from "./scripts/pool.json" with { type: "json" };
import swapValidator from "./scripts/swap.json" with { type: "json" };

export const poolValidatorScript = {
    type: "PlutusV2" as ScriptType,
    script: poolValidator.cborHex,
};

export const swapValidatorScript = {
    type: "PlutusV2" as ScriptType,
    script: swapValidator.cborHex,
};

export type PoolTokenSet = { [key: string]: bigint };

export const poolValidatorAddress = (lucid: Lucid) => lucid.utils.validatorToAddress(poolValidatorScript);
export const swapValidatorAddress = (lucid: Lucid) => lucid.utils.validatorToAddress(swapValidatorScript);

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

    const extractedTokenSet = extractTokenInfo(poolTokenSet);

    const poolDatum: PoolDatum = {
        poolNft: [extractedTokenSet.lp.policyId, fromText(extractedTokenSet.lp.tokenName)],
        poolX: ["", ""],
        poolY: [extractedTokenSet.native.policyId, fromText(extractedTokenSet.native.tokenName)],
        poolLq: [extractedTokenSet.lp.policyId, fromText(extractedTokenSet.lp.tokenName)],
        feeNum: 995n,
        stakeAdminPolicy: [stakeAdminPolicyId],
        lqBound: 0n
    };

    console.log("Pool Datum", poolDatum);

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

    if (waitTx)
        await lucid.awaitTx(txHash);

    return txHash;
};


export const createSwapOrder = (
    baseIsAda: boolean,
    baseAmount: bigint,
    collateralAda: bigint,
    minExFee: bigint,
    slippage = 3,
    poolDatum: PoolDatum,
    poolValue: Assets,
    rewardPkh: string,
    stakePkh: string | null,
    baseAsset = ["", ""],
): [SwapDatum, bigint] => {
    const noAdaPair = poolDatum.poolX[0] !== "" && poolDatum.poolY[0] !== "";
    const x = poolDatum.poolX;
    const y = poolDatum.poolY;
    const feeDen = 1000n;
    const exFeePerTokenDen = 1000000000000000n;

    if (!noAdaPair) {
        const baseAsset = baseIsAda
            ? ["", ""]
            : [x, y].find((asset) => asset[0] !== "");
        const quoteAsset = baseIsAda
            ? [x, y].find((asset) => asset[0] !== "")
            : ["", ""];
        const reservesBase = poolValue[
            baseIsAda ? "lovelace" : baseAsset![0].concat(baseAsset![1]).toLowerCase()
        ];
        const reservesQuote = poolValue[
            baseIsAda
                ? quoteAsset![0].concat(quoteAsset![1]).toLowerCase()
                : "lovelace"
        ];
        const correctOutput = calculateCorrectOutput(
            baseAmount,
            reservesBase,
            reservesQuote,
            poolDatum.feeNum,
            feeDen,
        );
        const slippageFactor = BigInt(100 - slippage);
        const minQuoteAmount = (correctOutput * slippageFactor) / 100n;
        console.log({ minQuoteAmount });
        const exFeePerTokenNum = (minExFee * exFeePerTokenDen) / BigInt(minQuoteAmount);
        // 874388034668901944
        // 5 ADA total input -> 1 ADA baseAmount -> 2 ADA nitro/executor Fee -> 2 ADA collateral
        // exFee = 2 ADA
        //  ======= minimum 10 TEDY <- 1.8 ADA + 10 TEDY 4 ADA
        // nft -> 100 0.3
        console.log({ exFeePerTokenNum });
        /*
            const poolDatum: PoolDatum = {
                poolNft: [extractedTokenSet.lp.policyId, fromText(extractedTokenSet.lp.tokenName)],
                poolX: ["", ""],
                poolY: [extractedTokenSet.native.policyId, fromText(extractedTokenSet.native.tokenName)],
                poolLq: [extractedTokenSet.lp.policyId, fromText(extractedTokenSet.lp.tokenName)],
                feeNum: 995n,
                stakeAdminPolicy: [stakeAdminPolicyId],
                lqBound: 0n
            };
        */
        const swapDatum: SwapDatum = {
            base: [baseAsset![0], baseAsset![1]],
            quote: [quoteAsset![0], quoteAsset![1]],
            poolNft: poolDatum.poolNft,
            feeNum: poolDatum.feeNum,
            exFeePerTokenNum,
            exFeePerTokenDen,
            rewardPkh,
            stakePkh,
            baseAmount,
            minQuoteAmount: minQuoteAmount,
        };
        const minAda = baseIsAda
            ? baseAmount + minExFee + collateralAda
            : minExFee + collateralAda;
        console.log({ swapDatum, minAda });
        return [swapDatum, minAda];
    } else {
        const baseAssetStr = baseAsset[0].concat(baseAsset[1]).toLowerCase();
        const quoteAsset = [x, y].find((asset) =>
            asset[0].concat(asset[1]).toLowerCase() !== baseAssetStr
        );
        const reservesBase = poolValue[baseAssetStr];
        const reservesQuote =
            poolValue[quoteAsset![0].concat(quoteAsset![1]).toLowerCase()];
        const correctOutput = calculateCorrectOutput(
            baseAmount,
            reservesBase,
            reservesQuote,
            poolDatum.feeNum,
            feeDen,
        );
        const slippageFactor = BigInt(100 - slippage);
        const minQuoteAmount = (correctOutput * slippageFactor) / 100n;
        console.log({ minQuoteAmount });
        const exFeePerTokenNum = (minExFee * exFeePerTokenDen) / BigInt(minQuoteAmount);
        const swapDatum: SwapDatum = {
            base: [baseAsset![0], baseAsset![1]],
            quote: [quoteAsset![0], quoteAsset![1]],
            poolNft: poolDatum.poolNft,
            feeNum: poolDatum.feeNum,
            exFeePerTokenNum,
            exFeePerTokenDen,
            rewardPkh,
            stakePkh,
            baseAmount,
            minQuoteAmount: minQuoteAmount,
        };
        const minAda = minExFee + collateralAda;
        return [swapDatum, minAda];
    }
};

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
        console.log("pool utxo not found", err);
    }
    return [poolVRefScriptUtxo[0], poolUtxo, poolDatum];
};

export const findPoolUtxo = async (
    poolAddr: string,
    unit: string,
    lucid: Lucid,
): Promise<UTxO> => {
    const utxos: UTxO[] = await lucid.provider.getUtxosWithUnit(poolAddr, unit);
    return utxos[0];
};

export const createScriptReferenceAsync = async (lucid: Lucid, validatorScript: Script) => {
    const scriptAddr = lucid.utils.validatorToAddress(validatorScript);
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
        console.log({poolAssets, poolRefScriptUtxo, swapRefScriptUtxo});
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

        console.log("Submitting Execute Swap Order");
        const signedTx = await finalTx.sign().complete();
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

        console.log("Submitting Execute Swap Order");
        const signedTx = await finalTx.sign().complete();
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