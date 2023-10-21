import { Lucid, Script, fromText } from "https://deno.land/x/lucid@0.10.7/mod.ts";
import { MAX_LP_CAP } from "./constants.ts";

export const createMintPolicyWithAddress = (lucid: Lucid, minterAddress: string) => {
    const { paymentCredential } = lucid.utils.getAddressDetails(
        minterAddress,
    );

    return lucid.utils.nativeScriptFromJson(
        {
            type: "all",
            scripts: [
                { type: "sig", keyHash: paymentCredential?.hash }
            ],
        },
    );
}

export const getPolicyId = (lucid: Lucid, mintPolicy: Script) => {
    return lucid.utils.mintingPolicyToId(mintPolicy);
}

export const mintTokenAsync = async (lucid: Lucid, mintPolicy: Script, tokenName: string, amount: bigint, waitTx = true) => {
    const policyId = lucid.utils.mintingPolicyToId(mintPolicy);
    const unit = policyId + fromText(tokenName);
    const tx = await lucid.newTx()
        .mintAssets({ [unit]: amount })
        .validTo(Date.now() + 200000)
        .attachMintingPolicy(mintPolicy)
        .complete();

    const signedTx = await tx.sign().complete();

    const txHash = await signedTx.submit();

    if (waitTx)
        await lucid.awaitTx(txHash);

    return txHash;
}

export const burnTokenAsync = async (lucid: Lucid, mintPolicy: Script, tokenName: string, amount: bigint, waitTx = true) => {
    return await mintTokenAsync(lucid, mintPolicy, tokenName, -amount, waitTx);
}

export const mintAdaPoolTokenSetAsync = async (lucid: Lucid, changeAddr: string, tokenName: string) => {
    const LP_TOKEN_NAME = `ADA_${tokenName}_LP`;
    const IDENTITY_TOKEN_NAME = `ADA_${tokenName}_IDENTITY`;
    const TOKEN_NAME = tokenName;
    const mintPolicy = createMintPolicyWithAddress(lucid, changeAddr);
    const POLICT_ID = getPolicyId(lucid, mintPolicy);

    console.log(`Minting ADA_${tokenName}_LP, waiting for confirmation...`);
    const mintTxHash = await mintTokenAsync(lucid, createMintPolicyWithAddress(lucid, changeAddr), `ADA_${tokenName}_LP`, MAX_LP_CAP);
    console.log(`Minted ADA_${tokenName}_LP`, mintTxHash);
    await lucid.wallet.getUtxos();
    console.log(`Minting ADA_${tokenName}_IDENTITY, waiting for confirmation...`);
    const mintTxHash2 = await mintTokenAsync(lucid, createMintPolicyWithAddress(lucid, changeAddr), `ADA_${tokenName}_IDENTITY`, 1n);
    console.log(`Minted ADA_${tokenName}_IDENTITY`, mintTxHash2);
    await lucid.wallet.getUtxos();
    console.log(`Minting ${tokenName}, waiting for confirmation...`);
    const mintTxHash3 = await mintTokenAsync(lucid, createMintPolicyWithAddress(lucid, changeAddr), tokenName, 1000000000000000n);
    console.log(`Minted ${tokenName}`, mintTxHash3);

    return {
        [`${POLICT_ID}.${LP_TOKEN_NAME}`]: MAX_LP_CAP,
        [`${POLICT_ID}.${IDENTITY_TOKEN_NAME}`]: 1n,
        [`${POLICT_ID}.${TOKEN_NAME}`]: 1000000000000000n,
    };
}

export const burnAdaPoolTokenSetAsync = async (lucid: Lucid, changeAddr: string, tokenName: string) => {
    const LP_TOKEN_NAME = `ADA_${tokenName}_LP`;
    const IDENTITY_TOKEN_NAME = `ADA_${tokenName}_IDENTITY`;
    const TOKEN_NAME = tokenName;
    const mintPolicy = createMintPolicyWithAddress(lucid, changeAddr);
    const POLICT_ID = getPolicyId(lucid, mintPolicy);

    console.log(`Burning ADA_${tokenName}_LP, waiting for confirmation...`);
    const mintTxHash = await burnTokenAsync(lucid, mintPolicy, `ADA_${tokenName}_LP`, MAX_LP_CAP);
    console.log(`Burned ADA_${tokenName}_LP`, mintTxHash);
    await lucid.wallet.getUtxos();
    console.log(`Burning ADA_${tokenName}_IDENTITY, waiting for confirmation...`);
    const mintTxHash2 = await burnTokenAsync(lucid, mintPolicy, `ADA_${tokenName}_IDENTITY`, 1n);
    console.log(`Burned ADA_${tokenName}_IDENTITY`, mintTxHash2);
    await lucid.wallet.getUtxos();
    console.log(`Burning ${tokenName}, waiting for confirmation...`);
    const mintTxHash3 = await burnTokenAsync(lucid, mintPolicy, tokenName, 1000000000000000n);
    console.log(`Burned ${tokenName}`, mintTxHash3);

    return {
        [`${POLICT_ID}.${LP_TOKEN_NAME}`]: MAX_LP_CAP,
        [`${POLICT_ID}.${IDENTITY_TOKEN_NAME}`]: 1n,
        [`${POLICT_ID}.${TOKEN_NAME}`]: 1000000000000000n,
    };
}