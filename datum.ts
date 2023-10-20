import { Data, MintingPolicy } from "https://deno.land/x/lucid@0.10.7/mod.ts";

export type MintData = {
    lqV: MintingPolicy;
    nftV: MintingPolicy;
    lqTn: string;
    nftTn: string;
    lqAmount: bigint;
    nftAmount: bigint;
    rawConfig: TeddyPoolMintConfig;
};

export type TeddyPoolMintConfig = {
    lqVCbor: string;
    nftVCbor: string;
    nativeCbor: MintingPolicy;
    lqTn: string;
    nftTn: string;
    assetXTn: string;
    assetYTn: string;
    lqAmount: bigint;
    assetXAmount: bigint;
    assetYAmount: bigint;
};


export const AssetClassSchema = Data.Tuple([Data.Bytes(), Data.Bytes()], { hasConstr: true });

export const SwapDatumSchema = Data.Object({
    base: AssetClassSchema,
    quote: AssetClassSchema,
    poolNft: AssetClassSchema,
    feeNum: Data.Integer(),
    exFeePerTokenNum: Data.Integer(),
    exFeePerTokenDen: Data.Integer(),
    rewardPkh: Data.Bytes(),
    stakePkh: Data.Nullable(Data.Bytes()),
    baseAmount: Data.Integer(),
    minQuoteAmount: Data.Integer(),
});

export const DepositDatumSchema = Data.Object({
    poolNft: AssetClassSchema,
    x: AssetClassSchema,
    y: AssetClassSchema,
    lq: AssetClassSchema,
    exFee: Data.Integer(),
    rewardPkh: Data.Bytes(),
    stakePkh: Data.Nullable(Data.Bytes()),
    collateralAda: Data.Integer(),
});

export const RedeemDatumSchema = Data.Object({
    poolNft: AssetClassSchema,
    x: AssetClassSchema,
    y: AssetClassSchema,
    lq: AssetClassSchema,
    exFee: Data.Integer(),
    rewardPkh: Data.Bytes(),
    stakePkh: Data.Nullable(Data.Bytes()),
});

export const PoolDatumSchema = Data.Object({
    poolNft: AssetClassSchema,
    poolX: AssetClassSchema,
    poolY: AssetClassSchema,
    poolLq: AssetClassSchema,
    feeNum: Data.Integer(),
    stakeAdminPolicy: Data.Array(Data.Bytes()),
    lqBound: Data.Integer(),
});

export type PoolDatum = Data.Static<typeof PoolDatumSchema>;
export type SwapDatum = Data.Static<typeof SwapDatumSchema>;
export type DepositDatum = Data.Static<typeof DepositDatumSchema>;
export type RedeemDatum = Data.Static<typeof RedeemDatumSchema>;
export type AssetClassType = Data.Static<typeof AssetClassSchema>;

export const PoolDatum = PoolDatumSchema as unknown as PoolDatum;
