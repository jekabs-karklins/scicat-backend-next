'use strict';

var config = require('../../server/config.local');
var p = require('../../package.json');
var utils = require('./utils');
var dsl = require('./dataset-lifecycle.json');
var ds = require('./dataset.json');
var dsr = require('./raw-dataset.json');
var dsd = require('./derived-dataset.json');
var own = require('./ownable.json');

// TODO Auto-create history for remote calls

// TODO Add delete functionality for dataset, which removes Dataset and all linked data: OrigDatablock and Datablock and DatasetAttachments

module.exports = function (Dataset) {
    var app = require('../../server/server');
    // make sure that all times are UTC

    Dataset.validatesUniquenessOf('pid');

    // // put
    // Dataset.beforeRemote('replaceOrCreate', function (ctx, instance, next) {
    //     utils.updateTimesToUTC(['creationTime'], ctx.args.data);
    //     utils.keepHistory(ctx, next)
    // });

    // // patch
    // Dataset.beforeRemote('patchOrCreate', function (ctx, instance, next) {
    //     utils.updateTimesToUTC(['creationTime'], ctx.args.data);
    //     utils.keepHistory(ctx, next)
    // });

    // // post
    // Dataset.beforeRemote('create', function (ctx, unused, next) {
    //     utils.updateTimesToUTC(['creationTime'], ctx.args.data);
    //     utils.keepHistory(ctx, next)
    // });

    // // TODO replace the *.* by the real name needed
    // // remove history field from remote output  as discussed here: https://loopback.io/doc/en/lb3/Remote-hooks.html#overview ?
    // // update attributes
    // Dataset.beforeRemote('*.*', function (ctx, unused, next) {
    //     utils.updateTimesToUTC(['creationTime'], ctx.args.data);
    //     utils.keepHistory(ctx, next)
    // });

    function addDefaultPolicy(ownerGroup, ownerEmail, tapeRedundancy, ctx, next) {
        var Policy = app.models.Policy;
        var defaultPolicy = Object();
        defaultPolicy.ownerGroup = ownerGroup;
        if (config && !ownerEmail) {
            defaultPolicy.manager = config.defaultManager;
        } else if (ownerEmail) {
            defaultPolicy.manager = ownerEmail.split(",");
        } else {
            defaultPolicy.manager = "";
        }
        if (tapeRedundancy) {
            defaultPolicy.tapeRedundancy = tapeRedundancy;
        } else {
            defaultPolicy.tapeRedundancy = "low"; // AV default low
        }
        defaultPolicy.autoArchive = false;
        defaultPolicy.autoArchiveDelay = 7;
        defaultPolicy.archiveEmailNotification = true;
        defaultPolicy.retrieveEmailNotification = true;
        defaultPolicy.archiveEmailsToBeNotified = defaultPolicy.manager;
        defaultPolicy.retrieveEmailsToBeNotified = defaultPolicy.manager;
        defaultPolicy.embargoPeriod = 3;
        Policy.create(defaultPolicy, ctx.options, function (err, instance) {
            if (err) {
                console.log("Error when creating default policy:", err)
                return next(err)
            }
            utils.keepHistory(ctx,next)
        });
    };

    // auto add pid
    Dataset.observe('before save', (ctx, next) => {
        if (ctx.instance) {
            if (ctx.isNewInstance) {
                ctx.instance.pid = config.pidPrefix + '/' + ctx.instance.pid;
                console.log('New pid:', ctx.instance.pid);
                // fill d
            } else {
                console.log('Unmodified pid:', ctx.instance.pid);
            }
            ctx.instance.version = p.version;

            // sourceFolder handling
            if (ctx.instance.sourceFolder) {
                // remove trailing slashes
                ctx.instance.sourceFolder = ctx.instance.sourceFolder.replace(/\/$/, "");
                // autofill datasetName
                if (!ctx.instance.datasetName) {
                    var arr = ctx.instance.sourceFolder.split("/")
                    if (arr.length == 1) {
                        ctx.instance.datasetName = arr[0]
                    } else {
                        ctx.instance.datasetName = arr[arr.length - 2] + "/" + arr[arr.length - 1]
                    }
                }
            }

            if (ctx.instance.datasetlifecycle) {
                // auto fill retention and publishing time
                var now = new Date();
                if (!ctx.instance.datasetlifecycle.archiveRetentionTime) {
                    var retention = new Date(now.setFullYear(now.getFullYear() + config.policyRetentionShiftInYears));
                    ctx.instance.datasetlifecycle.archiveRetentionTime = retention.toISOString().substring(0, 10);
                }
                if (!ctx.instance.datasetlifecycle.dateOfPublishing) {
                    now = new Date(); // now was modified above
                    var pubDate = new Date(now.setFullYear(now.getFullYear() + config.policyPublicationShiftInYears));
                    ctx.instance.datasetlifecycle.dateOfPublishing = pubDate.toISOString().substring(0, 10);
                }
            }
            // auto fill classification and add policy if missing

            var Policy = app.models.Policy;
            const filter = {
                where: {
                    ownerGroup: ctx.instance.ownerGroup
                }
            };
            Policy.findOne(filter, ctx.options, function (err, policyInstance) {
                if (err) {
                    var msg = "Error when looking for Policy of pgroup " + ctx.instance.ownerGroup + " " + err;
                    console.log(msg);
                    next(msg);
                } else if (policyInstance) {
                    if (!ctx.instance.classification) {
                        // Case 1: classification undefined but policy defined:, define classification via policy
                        var classification = "";
                        switch (policyInstance.tapeRedundancy) {
                            case "low":
                                classification = "IN=medium,AV=low,CO=low";
                                break;
                            case "medium":
                                classification = "IN=medium,AV=medium,CO=low";
                                break;
                            case "high":
                                classification = "IN=medium,AV=high,CO=low";
                                break;
                            default:
                                classification = "IN=medium,AV=low,CO=low";
                        }
                        ctx.instance.classification = classification;
                    }
                    // case 2: classification defined and policy defined: do nothing
                    utils.keepHistory(ctx,next)
                } else {
                    let tapeRedundancy = "low"
                    if (!ctx.instance.classification) {
                        // case 3: neither a policy nor a classification exist: define default classification and create default policy
                        ctx.instance.classification = "IN=medium,AV=low,CO=low";
                    } else {
                        // case 4: classification exists but no policy: create policy from classification
                        var classification = ctx.instance.classification;
                        if (classification.includes("AV=low")) {
                            tapeRedundancy = "low";
                        } else if (classification.includes("AV=medium")) {
                            tapeRedundancy = "medium";
                        } else if (classification.includes("AV=high")) {
                            tapeRedundancy = "high";
                        }
                    }
                    addDefaultPolicy(ctx.instance.ownerGroup, ctx.instance.ownerEmail, tapeRedundancy, ctx, next);
                }
            });
        } else {
            // update case
            utils.keepHistory(ctx,next)
        }
    });


    // clean up data connected to a dataset, e.g. if archiving failed
    // TODO can the additional findbyId calls be avoided ?

    Dataset.reset = function (id, options, next) {
        var Datablock = app.models.Datablock;
        Dataset.findById(id, options, function (err, l) {
            if (err) {
                next(err);
            } else {
                l.updateAttributes({
                    datasetlifecycle: {
                        archivable: true,
                        retrievable: false,
                        publishable: false,
                        archiveStatusMessage: 'datasetCreated',
                        retrieveStatusMessage: '',
                        retrieveIntegrityCheck: false
                    },
                    packedSize: 0
                }, options, function (err, dsInstance) {
                    Datablock.destroyAll({
                        datasetId: id,
                    }, options, function (err, b) {
                        if (err) {
                            next(err);
                        } else {
                            next()
                        }
                    });
                });
            }
        });
    };


    /**
     * Inherited models will not call this before access, so it must be replicated
     */

    // add user Groups information of the logged in user to the fields object

    Dataset.beforeRemote('fullfacet', function (ctx, userDetails, next) {
        utils.handleOwnerGroups(ctx, next);
    });

    Dataset.beforeRemote('fullquery', function (ctx, userDetails, next) {
        utils.handleOwnerGroups(ctx, next);
    });

    function searchExpression(key, value) {
        let type = "string"
        if (key in ds.properties) {
            type = ds.properties[key].type
        } else if (key in dsr.properties) {
            type = dsr.properties[key].type
        } else if (key in dsd.properties) {
            type = dsd.properties[key].type
        } else if (key in dsl.properties) {
            type = dsl.properties[key].type
        } else if (key in own.properties) {
            type = own.properties[key].type
        }
        if (key === "text") {
            return {
                $search: value,
                $language: "none"
            }
        } else if (type === "string") {
            if (value.constructor === Array) {
                if (value.length == 1) {
                    return value[0]
                } else {
                    return {
                        $in: value
                    }
                }
            } else {
                return value
            }
        } else if (type === "date") {
            return {
                $gte: new Date(value.begin),
                $lte: new Date(value.end)
            }
        } else if (type.constructor === Array) {
            return {
                $in: value
            }
        }
    }

    Dataset.fullfacet = function (fields, facets = [], cb) {
        // keep the full aggregation pipeline definition
        let pipeline = []
        let match = {}
        let facetMatch = {}
        // construct match conditions from fields value, excluding facet material
        // i.e. fields is essentially split into match and facetMatch conditions
        // Since a match condition on usergroups is always prepended at the start
        // this effectively yields the intersection handling of the two sets (ownerGroup condition and userGroups)

        Object.keys(fields).map(function (key) {
            if (facets.indexOf(key) < 0) {
                if (key === "text") {
                    match["$or"] = [{
                        $text: searchExpression(key, fields[key])
                    }, {
                        sourceFolder: {
                            $regex: fields[key],
                            $options: 'i'
                        }
                    }]
                } else if (key === "userGroups") {
                    if (fields[key].length > 0)
                        match["ownerGroup"] = searchExpression(key, fields[key])
                } else {
                    match[key] = searchExpression(key, fields[key])
                }
            } else {
                facetMatch[key] = searchExpression(key, fields[key])
            }
        })
        if (match !== {}) {
            pipeline.push({
                $match: match
            })
        }

        // append all facet pipelines
        let facetObject = {};
        facets.forEach(function (facet) {
            if (facet in ds.properties) {
                facetObject[facet] = utils.createNewFacetPipeline(facet, ds.properties[facet].type, facetMatch);
            } else if (facet in dsr.properties) {
                facetObject[facet] = utils.createNewFacetPipeline(facet, dsr.properties[facet].type, facetMatch);
            } else if (facet in dsd.properties) {
                facetObject[facet] = utils.createNewFacetPipeline(facet, dsd.properties[facet].type, facetMatch);
            } else if (facet in own.properties) {
                facetObject[facet] = utils.createNewFacetPipeline(facet, own.properties[facet].type, facetMatch);
            } else {
                console.log("Warning: Facet not part of any dataset model:", facet)
            }
        });
        // add pipeline to count all documents
        facetObject['all'] = [{
            $match: facetMatch
        }, {
            $count: 'totalSets'
        }]

        pipeline.push({
            $facet: facetObject,
        });
        // console.log("Resulting aggregate query in fullfacet method:", JSON.stringify(pipeline, null, 4));
        Dataset.getDataSource().connector.connect(function (err, db) {
            var collection = db.collection('Dataset');
            var res = collection.aggregate(pipeline,
                function (err, cursor) {
                    cursor.toArray(function (err, res) {
                        if (err) {
                            console.log("Facet err handling:", err);
                        }
                        cb(err, res);
                    });
                });
        });
    };

    /* returns filtered set of datasets. Options:
       filter condition consists of
       - ownerGroup (automatically applied on server side)
       - text search
       - list of fields which are treated as filter condition (name,type,value triple)
     - paging of results
    */
    Dataset.fullquery = function (fields, limits, cb) {
        // keep the full aggregation pipeline definition
        let pipeline = []
        let match = {}
        let matchJoin = {}
        // construct match conditions from fields value, excluding facet material
        Object.keys(fields).map(function (key) {
            if (fields[key] && fields[key] !== 'null') {
                if (key === "text") {
                    match["$or"] = [{
                        $text: searchExpression(key, fields[key])
                    }, {
                        sourceFolder: {
                            $regex: fields[key],
                            $options: 'i'
                        }
                    }]
                } else if (key === "ownerGroup") {
                    // ownerGroup is handled in userGroups parts
                } else if (key === "userGroups") {
                    // merge with ownerGroup condition if existing
                    if ('ownerGroup' in fields) {
                        if (fields[key].length == 0) {
                            // if no userGroups defined take all ownerGroups
                            match["ownerGroup"] = searchExpression('ownerGroup', fields['ownerGroup'])
                        } else {
                            // otherwise create intersection of userGroups and ownerGroup
                            // this is needed here since no extra match step is done but all
                            // filter conditions are applied in one match step
                            const intersect = fields['ownerGroup'].filter(function (n) {
                                return fields['userGroups'].indexOf(n) !== -1;
                            });
                            match["ownerGroup"] = searchExpression('ownerGroup', intersect)
                        }
                    } else {
                        // only userGroups defined
                        if (fields[key].length > 0) {
                            match["ownerGroup"] = searchExpression('ownerGroup', fields['userGroups'])
                        }
                    }
                } else {
                    // check if field is in linked models
                    if (key in dsl.properties) {
                        matchJoin["datasetlifecycle." + key] = searchExpression(key, fields[key])
                    } else {
                        match[key] = searchExpression(key, fields[key])
                    }
                }
            }
        })
        if (match !== {}) {
            pipeline.push({
                $match: match
            })
        }

        if (Object.keys(matchJoin).length > 0) {
            pipeline.push({
                $match: matchJoin
            })

        }
        // final paging section ===========================================================
        if (limits) {
            if ("order" in limits) {
                // input format: "creationTime:desc,creationLocation:asc"
                const sortExpr = {}
                const sortFields = limits.order.split(',')
                sortFields.map(function (sortField) {
                    const parts = sortField.split(':')
                    const dir = (parts[1] == 'desc') ? -1 : 1
                    sortExpr[parts[0]] = dir
                })
                pipeline.push({
                    $sort: sortExpr
                    // e.g. { $sort : { creationLocation : -1, creationLoation: 1 } }
                })
            }

            if ("skip" in limits) {
                pipeline.push({
                    $skip: (Number(limits.skip) < 1) ? 0 : Number(limits.skip)
                })
            }
            if ("limit" in limits) {
                pipeline.push({
                    $limit: (Number(limits.limit) < 1) ? 1 : Number(limits.limit)
                })
            }
        }
        // console.log("Resulting aggregate query in fullquery method:", JSON.stringify(pipeline, null, 4));

        Dataset.getDataSource().connector.connect(function (err, db) {
            var collection = db.collection('Dataset');
            var res = collection.aggregate(pipeline,
                function (err, cursor) {
                    cursor.toArray(function (err, res) {
                        if (err) {
                            console.log("Facet err handling:", err);
                        }
                        // console.log("Query result:", res)
                        // rename _id to pid
                        res.map(ds => {
                            Object.defineProperty(ds, 'pid', Object.getOwnPropertyDescriptor(ds, '_id'));
                            delete ds['_id']
                        })
                        cb(err, res);
                    });
                });

        });
    };

    Dataset.isValid = function (dataset, next) {
        var ds = new Dataset(dataset);
        ds.isValid(function (valid) {
            if (!valid) {
                next(null, {
                    'errors': ds.errors,
                    'valid': false,
                });
            } else {
                next(null, {
                    'valid': true,
                });
            }
        });
    };

    Dataset.thumbnail = async function (id) {
        var DatasetAttachment = app.models.DatasetAttachment;
        const filter = {
            where: {
                datasetId: id
            }
        };
        return DatasetAttachment.findOne(filter).then(instance => {

            const base64string_example = "data:image/png;base64,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";
            let base64string2 = ""
            if (instance && instance.__data) {
                if (instance.__data.thumbnail === undefined) {} else {
                    base64string2 = instance.__data.thumbnail;
                }
            } else {
                base64string2 = base64string_example;
            }
            return base64string2;
        });
    }

    Dataset.remoteMethod("thumbnail", {
        accepts: [{
            arg: "id",
            type: "string",
            required: true
        }],
        http: {
            path: "/:id/thumbnail",
            verb: "get"
        },
        returns: {
            type: "string",
            root: true
        }
    });


};
