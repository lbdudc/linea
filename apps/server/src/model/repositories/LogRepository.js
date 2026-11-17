import mongoose from "mongoose";
import MongooseRepository from "./MongooseRepository.js";
import Log from "../entities/log.js"
import { Container } from "typedi"

const toObjectIds = (ids = []) => ids
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));

// A `$match` over the raw logs for a user's scope, or nothing when the call is not scoped.
const scopeStage = (scope) => {
    if (!scope) return [];
    const productIds = toObjectIds(scope.productIds);
    const lineIds = toObjectIds(scope.lineIds);
    return [{ $match: { $or: [{ productId: { $in: productIds } }, { lineId: { $in: lineIds } }] } }];
};

// The outcome of a deployment is how its last attempt ended: a version that failed and was then generated again is a success.
// `typeSeq` is the types of its logs in order; with no terminal one the deployment counts as a success, as it did before.
const FINAL_OUTCOME = {
    $let: {
        vars: { ended: { $filter: { input: '$typeSeq', as: 't', cond: { $in: ['$$t', ['error', 'warning', 'success', 'cancelled']] } } } },
        in: { $cond: [{ $eq: [{ $size: '$$ended' }, 0] }, 'success', { $arrayElemAt: ['$$ended', -1] }] },
    },
};

export default class LogRepository extends MongooseRepository {
    constructor() {
        super(Log);
    }

    async findByProductIdAndVersionOrderByCreatedAtAsc(productId, version) {
        return await this.model.find({ productId, version }).sort({ createdAt: 'asc' });
    }

    // The log lines a generation wrote under a version that turned out not to exist (it found nothing to commit).
    async deleteByProductIdAndVersionSince(productId, version, since) {
        return await this.model.deleteMany({ productId, version, createdAt: { $gte: since } });
    }

    // The versions a product really has. A generation that failed leaves its logs under the version it was
    // trying to create, but never produced it: a version exists once its merge request went through, or (for
    // runs that stopped short of it) once its code was generated without any error.
    async findVersionsByProductId(productId) {
        const merged = ['log.merged_merge_request', 'log.merged_merge_request_deleted', 'log.conflicts_merge_request'];
        return (await this.model.aggregate([
            { $match: { productId } },
            { $group: { _id: "$version", messages: { $addToSet: "$message" }, types: { $addToSet: "$type" } } },
            {
 $match: {
 $expr: {
 $or: [
                { $gt: [{ $size: { $setIntersection: ["$messages", merged] } }, 0] },
                { $and: [{ $in: ["log.generated_product", "$messages"] }, { $not: [{ $in: ["error", "$types"] }] }] },
            ] 
} 
} 
},
            { $project: { _id: 0, version: "$_id" } },
        ])).map((r) => r.version);
    }

    async findLastOutcomeByProductIds(productIds) {
        const results = await this.model.aggregate([
            { $match: { productId: { $in: toObjectIds(productIds) } } },
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: { productId: '$productId', version: '$version' },
                    typeSeq: { $push: '$type' },
                    deployedAt: { $max: '$createdAt' },
                },
            },
            { $addFields: { outcome: FINAL_OUTCOME } },
            { $sort: { deployedAt: -1 } },
            {
                $group: {
                    _id: '$_id.productId',
                    outcome: { $first: '$outcome' },
                    version: { $first: '$_id.version' },
                    at: { $first: '$deployedAt' },
                },
            },
        ]);
        return Object.fromEntries(results.map((r) => [String(r._id), { outcome: r.outcome, version: r.version, at: r.at }]));
    }

    async findLastSyncByProductIds(productIds) {
        const results = await this.model.aggregate([
            { $match: { productId: { $in: productIds } } },
            { $sort: { createdAt: -1 } },
            { $group: { _id: '$productId', lastSyncAt: { $first: '$createdAt' } } }
        ]);
        return Object.fromEntries(results.map(r => [String(r._id), r.lastSyncAt]));
    }

    // Paginated, filterable deployment history. A "deployment" is one (productId, version)
    // group — the same unit used by computeDeploymentMetrics — enriched with product/line names
    // and the GitLab branch/MR link so the history survives reloads (unlike the client store).
    // `scope` ({ lineIds, productIds }) narrows the history to what one user can see: a log belongs to the scope
    // when its product or its line (the snapshot kept on the log) is in it.
    async findDeployments({ outcome, productId, lineId, from, to, search, page = 1, rowsPerPage = 15, scope } = {}) {
        const skip = Math.max(0, (Number(page) - 1) * Number(rowsPerPage));
        const limit = Number(rowsPerPage);

        const pipeline = [
            ...scopeStage(scope),
            { $sort: { createdAt: 1 } },
            // One row per deployment; derive timestamps, step count and a representative link.
            {
                $group: {
                    _id: { productId: '$productId', version: '$version' },
                    types: { $addToSet: '$type' },
                    typeSeq: { $push: '$type' },
                    startedAt: { $min: '$createdAt' },
                    deployedAt: { $max: '$createdAt' },
                    steps: { $sum: 1 },
                    links: { $push: '$link' },
                    // Snapshots from whichever log wrote it — a fallback for when the
                    // product (and/or its line) no longer exists to join against below.
                    productNameSnapshot: { $last: '$productName' },
                    lineIdSnapshot: { $last: '$lineId' },
                    lineNameSnapshot: { $last: '$lineName' },
                },
            },
            {
                $addFields: {
                    outcome: FINAL_OUTCOME,
                    // Last non-empty link in the group — the branch / merge-request URL.
                    link: {
                        $arrayElemAt: [
                            { $filter: { input: '$links', as: 'l', cond: { $and: [{ $ne: ['$$l', null] }, { $ne: ['$$l', ''] }] } } },
                            -1,
                        ],
                    },
                },
            },
            { $lookup: { from: 'products', localField: '_id.productId', foreignField: '_id', as: 'product' } },
            // $unwind with preserveNullAndEmptyArrays leaves an unmatched lookup as an
            // EMPTY ARRAY, not null — `{ $eq: ['$product', null] }` is always false, even
            // for a genuinely deleted product. Decide "deleted" from the raw array's size
            // before unwinding, while it's unambiguous.
            { $addFields: { productDeleted: { $eq: [{ $size: '$product' }, 0] } } },
            { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
            // The product's own lineId when it still exists, else fall back to
            // whatever line the log snapshotted — so the line can still resolve
            // even once the product itself is gone.
            { $addFields: { effectiveLineId: { $ifNull: ['$product.lineId', '$lineIdSnapshot'] } } },
            { $lookup: { from: 'lines', localField: 'effectiveLineId', foreignField: '_id', as: 'line' } },
            { $addFields: { lineDeleted: { $eq: [{ $size: '$line' }, 0] } } },
            { $unwind: { path: '$line', preserveNullAndEmptyArrays: true } },
            {
                $project: {
                    _id: 0,
                    productId: '$_id.productId',
                    version: '$_id.version',
                    productName: { $ifNull: ['$product.spec.basicData.name', '$productNameSnapshot'] },
                    productDeleted: 1,
                    lineId: '$effectiveLineId',
                    lineName: { $ifNull: ['$line.deletedName', { $ifNull: ['$line.name', '$lineNameSnapshot'] }] },
                    lineDeleted: { $or: ['$lineDeleted', { $gt: ['$line.deletedAt', null] }] },
                    outcome: 1,
                    startedAt: 1,
                    deployedAt: 1,
                    steps: 1,
                    link: 1,
                },
            },
        ];

        const match = {};
        if (outcome) match.outcome = outcome;
        if (productId && mongoose.isValidObjectId(productId)) match.productId = new mongoose.Types.ObjectId(productId);
        if (lineId && mongoose.isValidObjectId(lineId)) match.lineId = new mongoose.Types.ObjectId(lineId);
        if (from || to) {
            match.deployedAt = {};
            if (from) match.deployedAt.$gte = new Date(from);
            if (to) match.deployedAt.$lte = new Date(to);
        }
        if (Object.keys(match).length) pipeline.push({ $match: match });

        if (search) {
            pipeline.push({
                $match: {
                    $or: [
                        { productName: { $regex: search, $options: 'i' } },
                        { lineName: { $regex: search, $options: 'i' } },
                    ],
                },
            });
        }

        pipeline.push(
            { $sort: { deployedAt: -1 } },
            {
                $facet: {
                    rows: [{ $skip: skip }, { $limit: limit }],
                    total: [{ $count: 'count' }],
                },
            },
        );

        const [result] = await this.model.aggregate(pipeline);
        return {
            rows: result?.rows ?? [],
            total: result?.total?.[0]?.count ?? 0,
        };
    }

    // One lightweight row per deployment (productId + version) of the scope that ended on or after `from`:
    // the input of the dashboard's windows, daily and monthly buckets.
    async findDeploymentOutcomes({ scope, from } = {}) {
        const pipeline = [
            ...scopeStage(scope),
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: { productId: '$productId', version: '$version' },
                    types: { $addToSet: '$type' },
                    typeSeq: { $push: '$type' },
                    deployedAt: { $max: '$createdAt' },
                },
            },
            {
                $project: {
                    _id: 0,
                    productId: '$_id.productId',
                    version: '$_id.version',
                    deployedAt: 1,
                    outcome: FINAL_OUTCOME,
                },
            },
        ];
        if (from) pipeline.push({ $match: { deployedAt: { $gte: new Date(from) } } });
        return this.model.aggregate(pipeline);
    }

    async computeDeploymentMetrics() {
        // Stage 1: one document per deployment (productId + version)
        // Collect all log types for the group; use the latest createdAt as the deployment timestamp.
        const deployments = await this.model.aggregate([
            { $sort: { createdAt: 1 } },
            {
                $group: {
                    _id: { productId: '$productId', version: '$version' },
                    types: { $addToSet: '$type' },
                    typeSeq: { $push: '$type' },
                    deployedAt: { $max: '$createdAt' },
                },
            },
            // Stage 2: derive outcome and month bucket
            {
                $addFields: {
                    outcome: FINAL_OUTCOME,
                    month: { $dateToString: { format: '%Y-%m', date: '$deployedAt', timezone: 'UTC' } },
                },
            },
        ]);

        // Count overall outcomes
        const byOutcome = { success: 0, warning: 0, error: 0 };
        const monthMap = {}; // 'YYYY-MM' → { success, warning, error }

        for (const d of deployments) {
            byOutcome[d.outcome] = (byOutcome[d.outcome] || 0) + 1;
            if (d.month) {
                if (!monthMap[d.month]) monthMap[d.month] = { success: 0, warning: 0, error: 0 };
                monthMap[d.month][d.outcome] = (monthMap[d.month][d.outcome] || 0) + 1;
            }
        }

        const total = deployments.length;
        const conflictRate = total > 0 ? Math.round(byOutcome.warning / total * 100) : 0;
        const byMonth = Object.keys(monthMap)
            .sort()
            .map(month => ({ month, ...monthMap[month] }));

        return { total, byOutcome, conflictRate, byMonth };
    }
}

Container.set(LogRepository, new LogRepository());