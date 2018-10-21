import flatMap from 'lodash/flatMap';
import isObject from 'lodash/isObject';
import differenceBy from 'lodash/differenceBy';
import head from 'lodash/head';
import each from 'lodash/each';
import isNumber from 'lodash/isNumber';
import isNull from 'lodash/isNull';
import includes from 'lodash/includes';
import filter from 'lodash/filter';
import minBy from 'lodash/minBy';
import uniqBy from 'lodash/uniqBy';
import map from 'lodash/map';
import reduce from 'lodash/reduce';
import size from 'lodash/size';
import {
    filterSpentAddressData,
    filterAddressDataWithPendingIncomingTransactions,
    transformAddressDataToInputs,
    filterAddressDataWithPendingOutgoingTransactions,
} from './addresses';
import { VALID_ADDRESS_WITHOUT_CHECKSUM_REGEX } from './utils';
import { DEFAULT_SECURITY } from '../../config';
import Errors from '../errors';
import { filterNonFundedBundles, constructBundlesFromTransactions } from './transfers';

/**
 *   Prepares inputs for sending transfer from locally stored address related information
 *   Starts from the search index (start) and stops when the threshold is reached
 *
 *   @method prepareInputs
 *   @param {array} addressData
 *   @param {number} limit - Inputs limit
 *   @param {number} threshold - Maximum value (balance) to stop the search
 *   @param {number} [security= 2]
 *
 *   @returns {object} inputs, balance
 **/
export const prepareInputs = (addressData, threshold, limit = 2, security = DEFAULT_SECURITY) => {
    const _throw = (error) => {
        throw new Error(error);
    };

    if (reduce(addressData, (acc, addressObject) => acc + addressObject.balance, 0) < threshold) {
        _throw(Errors.INSUFFICIENT_BALANCE);
    }

    // Return prematurely in case threshold is zero
    // This check prevents adding input on the first iteration
    // if address data has addresses with balance.
    if (!threshold) {
        _throw(Errors.INPUTS_THRESHOLD_CANNOT_BE_ZERO);
    }

    if (limit === 0) {
        _throw(Errors.INPUTS_LIMIT_CANNOT_BE_ZERO);
    }

    const inputs = filter(
        transformAddressDataToInputs(addressData, security),
        // Also filter addresses with zero balance
        (input) => input.balance > 0,
    );

    // First try to select inputs by optimal value i.e., select less inputs as possible
    const selectedInputsByOptimalValue = [];
    let availableBalance = 0;

    while (availableBalance < threshold) {
        const sortedInputs = sortInputsByOptimalValue(
            differenceBy(inputs, selectedInputsByOptimalValue, 'address'),
            threshold - availableBalance,
        );

        const input = head(sortedInputs);

        selectedInputsByOptimalValue.push(input);

        availableBalance += input.balance;
    }

    // If there is a limit applied on the number of selected inputs and
    // and if the selected inputs (by optimal value) exceed the limit

    // Then try to find inputs where inputs <= limit & sum(inputs) >= threshold
    // If sum exceeds threshold, try to select inputs with minimum size
    if (isNumber(limit) && size(selectedInputsByOptimalValue) > limit) {
        const inputsWithUniqueBalances = uniqBy(inputs, 'balance');

        const { exactMatches, exceeded } = subsetSumWithLimit(limit)(
            map(
                // Find subset sum with unique balances
                inputsWithUniqueBalances,
                (input) => input.balance,
            ),
            threshold,
        );

        // If there exists some inputs that satisfy sum(inputs) === threshold
        // Then choose those inputs as it won't require any remainder
        if (size(exactMatches)) {
            const match = head(exactMatches);
            const inputsWithExactMatch = filter(inputsWithUniqueBalances, (input) => includes(match, input.balance));
            const balance = reduce(inputsWithExactMatch, (acc, input) => acc + input.balance, 0);

            // Verify total balance === threshold
            if (balance !== threshold) {
                _throw(Errors.SOMETHING_WENT_WRONG_DURING_INPUT_SELECTION);
            }

            return {
                inputs: inputsWithExactMatch,
                balance,
            };
        }

        const findSetWithMinSize = () => {
            const inputsWithMinSize = minBy(exceeded, size);
            const finalInputs = filter(inputsWithUniqueBalances, (input) => includes(inputsWithMinSize, input.balance));
            const balance = reduce(finalInputs, (acc, input) => acc + input.balance, 0);

            if (balance <= threshold || size(inputsWithMinSize) > limit) {
                _throw(Errors.SOMETHING_WENT_WRONG_DURING_INPUT_SELECTION);
            }

            return {
                inputs: finalInputs,
                balance,
            };
        };

        return size(exceeded) ? findSetWithMinSize() : _throw(Errors.CANNOT_FIND_INPUTS_WITH_PROVIDED_LIMIT);
    }

    return {
        inputs: selectedInputsByOptimalValue,
        balance: availableBalance,
    };
};

/**
 * Sorts inputs by optimal value
 *
 * @method sortInputsByOptimalValue
 * @param {array} inputs
 * @param {number} diff
 *
 * @returns {array}
 */
const sortInputsByOptimalValue = (inputs, diff) =>
    inputs.slice().sort((a, b) => Math.abs(diff - a.balance) - Math.abs(diff - b.balance));

/**
 * Given a list of balances and a threshold
 * attempts to find a subset (within provided limit) with an exact match.
 *
 * @method subsetSumWithLimit
 * @param {number} [limit]
 * @param {number} [MAX_CALL_TIMES]
 *
 * @returns {function(array, number, [array]): {object}}
 */
export const subsetSumWithLimit = (limit = 2, MAX_CALL_TIMES = 100000) => {
    let hasFoundAnExactMatch = false;
    let hasFoundNoMatches = false;

    const exactMatches = [];
    const exceeded = [];

    let callTimes = 0;
    let sizeOfBalances = 0;

    const calculate = (balances, threshold, partial = []) => {
        callTimes += 1;

        // Keep track of the initial size of balances
        if (callTimes === 1) {
            sizeOfBalances = size(balances);
        }

        const sizeOfPartial = size(partial);

        // Sum partial
        const sum = reduce(partial, (acc, value) => acc + value, 0);

        // Check if the partial sum equals threshold
        if (sum === threshold && sizeOfPartial <= limit) {
            exactMatches.push(partial);
            hasFoundAnExactMatch = true;
        }

        if (sum > threshold && sizeOfPartial <= limit) {
            exceeded.push(partial);
        }

        // If some has reached the threshold why bother continuing
        if (sum >= threshold) {
            return;
        }

        each(balances, (balance, index) => {
            // When finds an exact match, break the iteration
            if (hasFoundAnExactMatch) {
                return false;
            }

            if (index === sizeOfBalances - 1) {
                hasFoundNoMatches = true;
            }

            calculate(
                // Remaining balances
                balances.slice(index + 1),
                threshold,
                [...partial, balance],
            );
        });

        if (hasFoundAnExactMatch || hasFoundNoMatches || callTimes === MAX_CALL_TIMES) {
            return {
                exactMatches,
                exceeded,
            };
        }
    };

    return calculate;
};

/**
 *   Prepares inputs from addresses related info and filters out addresses that are already spent.
 *   Returns an object with all inputs with addresses that are unspent, total computed balance and
 *   balance associated with all addresses.
 *
 *   @method getInputs
 *   @param {string} [provider]
 *
 *   @returns {function(array, array, number, *): Promise<object>}
 **/
export const getInputs = (provider) => (addressData, transactions, threshold, maxInputs = null) => {
    // TODO: Validate address data & transactions
    // Check if there is sufficient balance
    if (reduce(addressData, (acc, addressObject) => acc + addressObject.balance, 0) < threshold) {
        return Promise.reject(new Error(Errors.INSUFFICIENT_BALANCE));
    }

    if (!isNull(maxInputs) && !isNumber(maxInputs)) {
        return Promise.reject(new Error(Errors.INVALID_MAX_INPUTS_PROVIDED));
    }

    // Filter transactions with non-funded inputs
    return filterNonFundedBundles(provider)(constructBundlesFromTransactions(transactions))
        .then((fundedBundles) => {
            // Remove addresses from addressData with (still funded) pending incoming transactions
            let addressDataForInputs = filterAddressDataWithPendingIncomingTransactions(
                addressData,
                flatMap(fundedBundles, (bundle) => bundle),
            );

            if (reduce(addressDataForInputs, (acc, addressObject) => acc + addressObject.balance, 0) < threshold) {
                throw new Error(Errors.INCOMING_TRANSFERS);
            }

            // Filter addresses with pending outgoing transactions
            addressDataForInputs = filterAddressDataWithPendingOutgoingTransactions(addressDataForInputs, transactions);

            if (reduce(addressDataForInputs, (acc, addressObject) => acc + addressObject.balance, 0) < threshold) {
                throw new Error(Errors.ADDRESS_HAS_PENDING_TRANSFERS);
            }

            // Filter all spent addresses
            return filterSpentAddressData(provider)(addressDataForInputs, transactions);
        })
        .then((unspentAddressData) => {
            if (reduce(unspentAddressData, (acc, addressObject) => acc + addressObject.balance, 0) < threshold) {
                throw new Error(Errors.FUNDS_AT_SPENT_ADDRESSES);
            }

            return prepareInputs(unspentAddressData, threshold, maxInputs);
        });
};

/**
 *   Checks if an input object is valid
 *
 *   @method isValidInput
 *   @param {object} input
 *
 *   @returns {boolean}
 **/
export const isValidInput = (input) => {
    return (
        isObject(input) &&
        VALID_ADDRESS_WITHOUT_CHECKSUM_REGEX.test(input.address) &&
        isNumber(input.balance) &&
        isNumber(input.security) &&
        isNumber(input.keyIndex) &&
        input.keyIndex >= 0
    );
};
