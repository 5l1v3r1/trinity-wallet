import head from 'lodash/head';
import isEqual from 'lodash/isEqual';
import map from 'lodash/map';
import { expect } from 'chai';
import nock from 'nock';
import { getIotaInstance, isNodeSynced } from '../../../libs/iota/extendedApi';
import { iota, SwitchingConfig } from '../../../libs/iota/index';
import { newZeroValueTransactionTrytes } from '../../__samples__/trytes';
import { EMPTY_HASH_TRYTES } from '../../../libs/iota/utils';
import { IRI_API_VERSION } from '../../../config';

describe('libs: iota/extendedApi', () => {
    before(() => {
        SwitchingConfig.autoSwitch = false;
    });

    after(() => {
        SwitchingConfig.autoSwitch = true;
    });

    describe('#getIotaInstance', () => {
        describe('when "provider" is passed as an argument', () => {
            it('should not return global iota instance', () => {
                const instance = getIotaInstance('provider');
                expect(isEqual(instance, iota)).to.equal(false);
            });
        });

        describe('when "provider" is not passed as an argument', () => {
            it('should return global iota instance', () => {
                const instance = getIotaInstance();
                expect(isEqual(instance, iota)).to.equal(true);
            });
        });
    });

    describe('#isNodeSynced', () => {
        describe('when latestMilestone is not equal to latestSolidSubtangleMilestone', () => {
            beforeEach(() => {
                nock('http://localhost:14265', {
                    reqheaders: {
                        'Content-Type': 'application/json',
                        'X-IOTA-API-Version': IRI_API_VERSION,
                    },
                })
                    .filteringRequestBody(() => '*')
                    .persist()
                    .post('/', '*')
                    .reply(200, (_, body) => {
                        const { command } = body;

                        const resultMap = {
                            getNodeInfo: {
                                latestMilestone: EMPTY_HASH_TRYTES,
                                latestSolidSubtangleMilestone: 'U'.repeat(81),
                            },
                        };

                        return resultMap[command] || {};
                    });
            });

            afterEach(() => {
                nock.cleanAll();
            });

            it('should throw with an error "Node not synced"', () => {
                return isNodeSynced()
                    .then(() => {
                        throw new Error();
                    })
                    .catch((error) => expect(error.message).to.equal('Node not synced'));
            });
        });

        describe(`when latestMilestone is ${EMPTY_HASH_TRYTES}`, () => {
            beforeEach(() => {
                nock('http://localhost:14265', {
                    reqheaders: {
                        'Content-Type': 'application/json',
                        'X-IOTA-API-Version': IRI_API_VERSION,
                    },
                })
                    .filteringRequestBody(() => '*')
                    .persist()
                    .post('/', '*')
                    .reply(200, (_, body) => {
                        const { command } = body;

                        const resultMap = {
                            getNodeInfo: {
                                latestMilestone: EMPTY_HASH_TRYTES,
                                latestSolidSubtangleMilestone: EMPTY_HASH_TRYTES,
                            },
                        };

                        return resultMap[command] || {};
                    });
            });

            afterEach(() => {
                nock.cleanAll();
            });

            it('should throw with an error "Node not synced"', () => {
                return isNodeSynced()
                    .then(() => {
                        throw new Error();
                    })
                    .catch((error) => expect(error.message).to.equal('Node not synced'));
            });
        });

        describe('when latestSolidSubtangleMilestoneIndex is 1 less than latestMilestoneIndex', () => {
            describe('when "timestamp" on trytes is from five minutes ago', () => {
                beforeEach(() => {
                    nock('http://localhost:14265', {
                        reqheaders: {
                            'Content-Type': 'application/json',
                            'X-IOTA-API-Version': IRI_API_VERSION,
                        },
                    })
                        .filteringRequestBody(() => '*')
                        .persist()
                        .post('/', '*')
                        .reply(200, (_, body) => {
                            const { command } = body;

                            const resultMap = {
                                getNodeInfo: {
                                    latestMilestoneIndex: 426550,
                                    latestSolidSubtangleMilestoneIndex: 426550 - 1,
                                    latestMilestone: 'U'.repeat(81),
                                    latestSolidSubtangleMilestone: 'A'.repeat(81),
                                },
                                getTrytes: { trytes: [head(newZeroValueTransactionTrytes)] },
                            };

                            return resultMap[command] || {};
                        });
                });

                afterEach(() => {
                    nock.cleanAll();
                });

                it('should return false', () => {
                    return isNodeSynced().then((result) => expect(result).to.equal(false));
                });
            });

            describe('when "timestamp" on trytes is within five minutes', () => {
                beforeEach(() => {
                    nock('http://localhost:14265', {
                        reqheaders: {
                            'Content-Type': 'application/json',
                            'X-IOTA-API-Version': IRI_API_VERSION,
                        },
                    })
                        .filteringRequestBody(() => '*')
                        .persist()
                        .post('/', '*')
                        .reply(200, (_, body) => {
                            const { command } = body;

                            const resultMap = {
                                getNodeInfo: {
                                    latestMilestoneIndex: 426550,
                                    latestSolidSubtangleMilestoneIndex: 426550 - 1,
                                    latestMilestone: 'U'.repeat(81),
                                    latestSolidSubtangleMilestone: 'A'.repeat(81),
                                },
                                getTrytes: {
                                    trytes: [
                                        head(
                                            map(newZeroValueTransactionTrytes, (tryteString) => {
                                                const transactionObject = iota.utils.transactionObject(tryteString);
                                                const timestampLessThanAMinuteAgo = Date.now() - 60000;

                                                return iota.utils.transactionTrytes({
                                                    ...transactionObject,
                                                    timestamp: Math.round(timestampLessThanAMinuteAgo / 1000),
                                                });
                                            }),
                                        ),
                                    ],
                                },
                            };

                            return resultMap[command] || {};
                        });
                });

                afterEach(() => {
                    nock.cleanAll();
                });

                it('should return true if "timestamp" on trytes is within five minutes', () => {
                    return isNodeSynced().then((result) => expect(result).to.equal(true));
                });
            });
        });

        describe(`when latestMilestone is not ${EMPTY_HASH_TRYTES} and is equal to latestSolidSubtangleMilestone`, () => {
            describe('when "timestamp" on trytes is from five minutes ago', () => {
                beforeEach(() => {
                    nock('http://localhost:14265', {
                        reqheaders: {
                            'Content-Type': 'application/json',
                            'X-IOTA-API-Version': IRI_API_VERSION,
                        },
                    })
                        .filteringRequestBody(() => '*')
                        .persist()
                        .post('/', '*')
                        .reply(200, (_, body) => {
                            const { command } = body;

                            const resultMap = {
                                getNodeInfo: {
                                    latestMilestone: 'U'.repeat(81),
                                    latestSolidSubtangleMilestone: 'U'.repeat(81),
                                },
                                getTrytes: { trytes: [head(newZeroValueTransactionTrytes)] },
                            };

                            return resultMap[command] || {};
                        });
                });

                afterEach(() => {
                    nock.cleanAll();
                });

                it('should return false', () => {
                    return isNodeSynced().then((result) => expect(result).to.equal(false));
                });
            });

            describe('when "timestamp" on trytes is within five minutes', () => {
                beforeEach(() => {
                    nock('http://localhost:14265', {
                        reqheaders: {
                            'Content-Type': 'application/json',
                            'X-IOTA-API-Version': IRI_API_VERSION,
                        },
                    })
                        .filteringRequestBody(() => '*')
                        .persist()
                        .post('/', '*')
                        .reply(200, (_, body) => {
                            const { command } = body;

                            const resultMap = {
                                getNodeInfo: {
                                    latestMilestone: 'U'.repeat(81),
                                    latestSolidSubtangleMilestone: 'U'.repeat(81),
                                },
                                getTrytes: {
                                    trytes: [
                                        head(
                                            map(newZeroValueTransactionTrytes, (tryteString) => {
                                                const transactionObject = iota.utils.transactionObject(tryteString);
                                                const timestampLessThanAMinuteAgo = Date.now() - 60000;

                                                return iota.utils.transactionTrytes({
                                                    ...transactionObject,
                                                    timestamp: Math.round(timestampLessThanAMinuteAgo / 1000),
                                                });
                                            }),
                                        ),
                                    ],
                                },
                            };

                            return resultMap[command] || {};
                        });
                });

                afterEach(() => {
                    nock.cleanAll();
                });

                it('should return true', () => {
                    return isNodeSynced().then((result) => expect(result).to.equal(true));
                });
            });
        });
    });
});
