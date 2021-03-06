/**
 * @license
 * Fuse - Lightweight fuzzy-search
 *
 * Copyright (c) 2012 Kirollos Risk <kirollos@gmail.com>.
 * All Rights Reserved. Apache Software License 2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
(function(global) {
  /**
   * Adapted from "Diff, Match and Patch", by Google
   *
   *   http://code.google.com/p/google-diff-match-patch/
   *
   * Modified by: Kirollos Risk <kirollos@gmail.com>
   * -----------------------------------------------
   * Details: the algorithm and structure was modified to allow the creation of
   * <Searcher> instances with a <search> method inside which does the actual
   * bitap search. The <pattern> (the string that is searched for) is only defined
   * once per instance and thus it eliminates redundant re-creation when searching
   * over a list of strings.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   */

  var defaultOptions = {
    // Approximately where in the text is the pattern expected to be found?
    location: 0,

    // Determines how close the match must be to the fuzzy location (specified above).
    // An exact letter match which is 'distance' characters away from the fuzzy location
    // would score as a complete mismatch. A distance of '0' requires the match be at
    // the exact location specified, a threshold of '1000' would require a perfect match
    // to be within 800 characters of the fuzzy location to be found using a 0.8 threshold.
    distance: 100,

    // At what point does the match algorithm give up. A threshold of '0.0' requires a perfect match
    // (of both letters and location), a threshold of '1.0' would match anything.
    threshold: 0.6,

    // Machine word size
    maxPatternLength: 32
  };

  function Searcher(pattern, options) {
    options = options || {};

    var MATCH_LOCATION = options.location || defaultOptions.location,
      MATCH_DISTANCE = 'distance' in options ? options.distance : defaultOptions.distance,
      MATCH_THRESHOLD = 'threshold' in options ? options.threshold : defaultOptions.threshold,
      MAX_PATTERN_LEN = options.maxPatternLength || defaultOptions.maxPatternLength,

      pattern = options.caseSensitive ? pattern : pattern.toLowerCase(),
      patternLen = pattern.length;

    if (patternLen > MAX_PATTERN_LEN) {
      throw new Error('Pattern length is too long');
    }

    var matchmask = 1 << (patternLen - 1);

    /**
     * Initialize the alphabet for the Bitap algorithm.
     * @return {Object} Hash of character locations.
     * @private
     */
    var pattern_alphabet = (function() {
      var mask = {},
        i = 0;

      for (i = 0; i < patternLen; i++) {
        mask[pattern.charAt(i)] = 0;
      }

      for (i = 0; i < patternLen; i++) {
        mask[pattern.charAt(i)] |= 1 << (pattern.length - i - 1);
      }

      return mask;
    })();

    /**
     * Compute and return the score for a match with `e` errors and `x` location.
     * @param {number} e Number of errors in match.
     * @param {number} x Location of match.
     * @return {number} Overall score for match (0.0 = good, 1.0 = bad).
     * @private
     */
    function match_bitapScore(e, x) {
      var accuracy = e / patternLen,
        proximity = Math.abs(MATCH_LOCATION - x);

      if (!MATCH_DISTANCE) {
        // Dodge divide by zero error.
        return proximity ? 1.0 : accuracy;
      }
      return accuracy + (proximity / MATCH_DISTANCE);
    }

    /**
     * Compute and return the result of the search
     * @param {String} text The text to search in
     * @return
     *     {Object} Literal containing:
     *     {Boolean} isMatch Whether the text is a match or not
     *     {Decimal} score Overall score for the match
     * @public
     */
    this.search = function(text) {
      text = options.caseSensitive ? text : text.toLowerCase();

      if (pattern === text) {
        // Exact match
        return {
          isMatch: true,
          score: 0
        };
      }

      var i, j,
        // Set starting location at beginning text and initialize the alphabet.
        textLen = text.length,
        // Highest score beyond which we give up.
        scoreThreshold = MATCH_THRESHOLD,
        // Is there a nearby exact match? (speedup)
        bestLoc = text.indexOf(pattern, MATCH_LOCATION),

        binMin, binMid,
        binMax = patternLen + textLen,

        lastRd, start, finish, rd, charMatch,

        score = 1,

        locations = [];

      if (bestLoc != -1) {
        scoreThreshold = Math.min(match_bitapScore(0, bestLoc), scoreThreshold);
        // What about in the other direction? (speedup)
        bestLoc = text.lastIndexOf(pattern, MATCH_LOCATION + patternLen);

        if (bestLoc != -1) {
          scoreThreshold = Math.min(match_bitapScore(0, bestLoc), scoreThreshold);
        }
      }

      bestLoc = -1;

      for (i = 0; i < patternLen; i++) {
        // Scan for the best match; each iteration allows for one more error.
        // Run a binary search to determine how far from 'MATCH_LOCATION' we can stray at this
        // error level.
        binMin = 0;
        binMid = binMax;
        while (binMin < binMid) {
          if (match_bitapScore(i, MATCH_LOCATION + binMid) <= scoreThreshold) {
            binMin = binMid;
          } else {
            binMax = binMid;
          }
          binMid = Math.floor((binMax - binMin) / 2 + binMin);
        }

        // Use the result from this iteration as the maximum for the next.
        binMax = binMid;
        start = Math.max(1, MATCH_LOCATION - binMid + 1);
        finish = Math.min(MATCH_LOCATION + binMid, textLen) + patternLen;

        // Initialize the bit array
        rd = Array(finish + 2);

        rd[finish + 1] = (1 << i) - 1;

        for (j = finish; j >= start; j--) {
          // The alphabet <pattern_alphabet> is a sparse hash, so the following line generates warnings.
          charMatch = pattern_alphabet[text.charAt(j - 1)];

          if (i === 0) {
            // First pass: exact match.
            rd[j] = ((rd[j + 1] << 1) | 1) & charMatch;
          } else {
            // Subsequent passes: fuzzy match.
            rd[j] = ((rd[j + 1] << 1) | 1) & charMatch | (((lastRd[j + 1] | lastRd[j]) << 1) | 1) | lastRd[j + 1];
          }
          if (rd[j] & matchmask) {
            score = match_bitapScore(i, j - 1);
            // This match will almost certainly be better than any existing match.
            // But check anyway.
            if (score <= scoreThreshold) {
              // Told you so.
              scoreThreshold = score;
              bestLoc = j - 1;
              locations.push(bestLoc);

              if (bestLoc > MATCH_LOCATION) {
                // When passing loc, don't exceed our current distance from loc.
                start = Math.max(1, 2 * MATCH_LOCATION - bestLoc);
              } else {
                // Already passed loc, downhill from here on in.
                break;
              }
            }
          }
        }

        // No hope for a (better) match at greater error levels.
        if (match_bitapScore(i + 1, MATCH_LOCATION) > scoreThreshold) {
          break;
        }
        lastRd = rd;
      }

      return {
        isMatch: bestLoc >= 0,
        score: score
      };
    }
  }


  var Utils = {
    /**
     * Traverse an object
     * @param {Object} The object to traverse
     * @param {String} A . separated path to a key in the object. Example 'Data.Object.Somevalue'
     * @return {Mixed}
     */
    deepValue: function(obj, path) {
      for (var i = 0, path = path.split('.'), len = path.length; i < len; i++) {
        if (!obj) {
          return null;
        }
        obj = obj[path[i]];
      };
      return obj;
    }
  };

  /**
   * @param {Array} list
   * @param {Object} options
   * @public
   */
  function Fuse(list, options) {
    options = options || {};
    var searchKeys = options.keys || [];

    /**
     * Searches for all the items whose keys (fuzzy) match the pattern.
     * @param {String} pattern The pattern string to fuzzy search on.
     * @return {Array} A list of all serch matches.
     * @public
     */
    this.search = function(pattern) {
      var searcher = new Searcher(pattern, options),
        i, j, item, text,
        dataLen = list.length,
        searchKeysLen = searchKeys.length,
        bitapResult, rawResults = [],
        index = 0,
        resultMap = {},
        rawResultsLen, existingResult, results = [],
        compute = null;

      /**
       * Calls <Searcher::search> for bitap analysis. Builds the raw result list.
       * @param {String} text The pattern string to fuzzy search on.
       * @param {String|Int} entity If the <data> is an Array, then entity will be an index,
       *                            otherwise it's the item object.
       * @param {Int} index
       * @return {Object|Int}
       * @private
       */
      function analyzeText(text, entity, index) {
        // Check if the text can be searched
        if (text !== undefined && text !== null && typeof text === 'string') {

          // Get the result
          bitapResult = searcher.search(text);

          // If a match is found, add the item to <rawResults>, including its score
          if (bitapResult.isMatch) {

            // Check if the item already exists in our results
            existingResult = resultMap[index];
            if (existingResult) {
              // Use the lowest score
              existingResult.score = Math.min(existingResult.score, bitapResult.score);
            } else {
              // Add it to the raw result list
              resultMap[index] = {
                item: entity,
                score: bitapResult.score
              };
              rawResults.push(resultMap[index]);
            }
          }
        }
      }

      // Check the first item in the list, if it's a string, then we assume
      // that every item in the list is also a string, and thus it's a flattened array.
      if (typeof list[0] === 'string') {
        // Iterate over every item
        for (; index < dataLen; index++) {
          analyzeText(list[index], index, index);
        }
      } else {
        // Otherwise, the first item is an Object (hopefully), and thus the searching
        // is done on the values of the keys of each item.

        // Iterate over every item
        for (; index < dataLen; index++) {
          item = list[index];
          // Iterate over every key
          for (j = 0; j < searchKeysLen; j++) {
            analyzeText(Utils.deepValue(item, searchKeys[j]), item, index);
          }
        }
      }

      // Sort the results, form lowest to highest score
      rawResults.sort(function(a, b) {
        return a.score - b.score;
      });

      // From the results, push into a new array only the item identifier (if specified)
      // of the entire item.  This is because we don't want to return the <rawResults>,
      // since it contains other metadata;
      rawResultsLen = rawResults.length;
      for (i = 0; i < rawResultsLen; i++) {
        results.push(options.id ? Utils.deepValue(rawResults[i].item, options.id) : rawResults[i].item);
      }

      return results;
    }
  }

  // Export to Common JS Loader
  if (typeof exports === 'object') {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = Fuse;
  } else if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(function() {
      return Fuse;
    });
  } else {
    // Browser globals (root is window)
    global.Fuse = Fuse;
  }

})(this);