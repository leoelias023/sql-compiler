import Command from '../../../constants/command.mjs';
import Comparator from '../../../constants/comparator.mjs';
import Delimiter from '../../../constants/delimiter.mjs';
import Operator from '../../../constants/operator.mjs';
import Other from '../../../constants/other.mjs';
import ReservedWord from '../../../constants/reserved-words.mjs';
import { walk } from '../parser.mjs';
import { isQuote } from './identifier.mjs';

/**
 * @param {Array<Object>} tokens Tokens sort
 * @param {Integer} index current index of tokens
 * @return {Boolean} if curret token is Union
 */
export function isUnion(tokens, index) {
  const current = tokens[index];
  return ReservedWord.UNION === current?.type;
}

/**
 * @param {Array<Object>} tokens Tokens sort
 * @param {Integer} index Current index of tokens
 * @return {String} type of union
 */
export function getUnionType(tokens, index) {
  const next = tokens[index + 1];

  if (isUnion(tokens, index) && ReservedWord.ALL === next?.type) {
    return Other.UNION_ALL;
  } else if (isUnion(tokens, index)) {
    return ReservedWord.UNION;
  }

  throw new Error('Union statement not found in current query');
}

/**
 * @param {Array<Object>} tokens Tokens sort.
 * @param {Integer} index Current token index.
 * @return {Integer} Right index of select part of union.
 */
export function getIndexNextSelect(tokens, index) {
  const unionType = getUnionType(tokens, index);

  switch (unionType) {
    case ReservedWord.UNION:
      return index + 1;
    case Other.UNION_ALL:
      return index + 2;
  }
}

/**
 * @param {*} tokens Tokens to be analyzed.
 * @param {*} index Index of current token.
 * @return {Boolean} If the current token is the init of WHERE clausule.
 */
export function isWhere(tokens, index) {
  return tokens[index]?.type === ReservedWord.WHERE;
}

const walkWhereParts = (tokens, index) => {
  let comparation;

  while (!ReservedWord.isEndOfWhere(tokens[index])) {
    if (Operator.isLogical(tokens[index]?.type)) {
      return {
        type: tokens[index].type,
        left: comparation,
        right: walkWhereParts(tokens, index + 1).value,
      };
    }

    if (Comparator.is(tokens[index + 1]?.type)) {
      const rightIndex = isQuote(tokens[index + 2]) ? 3 : 2;
      const { value: right } = walk(tokens, index + rightIndex);

      comparation = {
        type: tokens[index + 1].type,
        left: tokens[index],
        right,
      };
      index += rightIndex === 3 ? 4 : 3;
    } else {
      index++;
    }
  }

  return {
    value: comparation,
    index,
  };
};

/**
 * Split an array in subarrays of where parts.
 *
 * @param {*} arr Array to be splitted.
 * @param {*} delimiter Delimiter to be used as delimiter.
 * @return {Array<Array>} Array of subarrays.
 */
function splitTokensByConcatOperator(arr) {
  const arrays = [];
  let index = 0;

  while (index < arr.length) {
    const value = arr[index];

    if (value.type === Operator.getKeyFromValue(Operator.CONCAT)) {
      arrays.push(arr.slice(0, index));
      arr = arr.slice(index + 1);
      index = 0;
    } else {
      index++;
    }
  }

  return [...arrays, arr];
}

/**
 * @param {Array<Token>} parts Tokens to be analyzed that are part of Select column.
 * @return {Object} The AST (Abstract Syntax Tree) of column.
 */
export function processColumn({ parts, alias }) {
  if (
    parts.some(({ type }) => Operator.getKeyFromValue(Operator.CONCAT) === type)
  ) {
    const subParts = splitTokensByConcatOperator(parts);
    const subColumns = subParts.map(parts => processColumn({ parts }));

    return {
      type: Other.CONCATENATION,
      value: subColumns,
      alias,
    };
  }

  if (
    parts.length >= 3 &&
    parts[0]?.type === Other.IDENTIFIER &&
    parts[1]?.type === Delimiter.getKeyFromValue(Delimiter.LEFT_PARENTHESIS)
  ) {
    const args = parts.slice(2, parts.indexOf(Delimiter.RIGHT_PARENTHESIS));

    return {
      type: Other.FUNCTION_CALL,
      value: {
        name: parts[0].value,
        arguments: args,
      },
      alias,
    };
  }

  if (
    parts[0]?.type === Delimiter.getKeyFromValue(Delimiter.LEFT_PARENTHESIS)
  ) {
    const subTokens = parts.slice(
      1,
      parts.indexOf({
        type: Delimiter.getKeyFromValue(Delimiter.RIGHT_PARENTHESIS),
        value: Delimiter.RIGHT_PARENTHESISI,
      })
    );

    return {
      type: Other.PARENTHESIS,
      value: subTokens[0],
      alias,
    };
  }

  if (parts.length === 1) {
    return {
      type: parts[0].type,
      value: parts[0].value,
      alias,
    };
  }

  throw new Error('Unsupported column type: ' + JSON.stringify(parts));
}

/**
 * @param {*} tokens Tokens to be analyzed.
 * @param {*} index Current index of the token to be analyzed.
 * @return {*} If exist an alias, return the alias or undefined;
 */
export function getObjectAlias(tokens, index) {
  if (tokens[index]?.type === Command.AS) {
    return {
      type: Other.AS_ALIAS,
      value: tokens[index + 1],
    };
  }

  if (
    tokens[index]?.type === Other.IDENTIFIER &&
    tokens[index - 2]?.type === ReservedWord.FROM
  ) {
    return {
      type: Other.SHORT_ALIAS,
      value: tokens[index].value,
    };
  }
}

export default (tokens, index) => {
  const walkColumns = () => {
    const columns = [];
    let columnTmp;
    index++;

    const reset = () => {
      columnTmp = undefined;
    };

    const addColumn = (column, nextIndex) => {
      if (!columnTmp) {
        columnTmp = {
          columns: [column],
        };
      } else {
        columnTmp.columns.push(column);
      }
      index = nextIndex;
    };

    const addAlias = ({ value: alias }) => {
      columnTmp.alias = alias;
    };

    const buildColumn = () => {
      const { columns: parts, alias } = columnTmp;

      columns.push(
        processColumn({
          parts,
          alias,
        })
      );
      reset();
    };

    while (tokens[index]?.type !== ReservedWord.FROM) {
      if (tokens[index]?.type === Delimiter.getKeyFromValue(Delimiter.COMMA)) {
        buildColumn();
      } else if (tokens[index]?.type === ReservedWord.AS) {
        addAlias(walk(tokens, ++index).value);
      } else if (!isQuote(tokens[index])) {
        const { value: column, index: asd } = walk(tokens, index);
        addColumn(column, asd);
      }
      index++;
    }

    buildColumn();

    return columns;
  };

  const walkFrom = () => {
    index++;

    const { value: from } = walk(tokens, index);

    index++;

    const { value: alias, type: aliasType } =
      getObjectAlias(tokens, index) || {};

    switch (aliasType) {
      case Other.AS_ALIAS:
        index += 2;
        break;
      case Other.SHORT_ALIAS:
        index++;
    }

    return {
      type: Other.IDENTIFIER,
      value: from.value,
      alias: alias,
    };
  };

  const walkWhere = () => {
    const { value, index: whereIndex } = walkWhereParts(tokens, ++index);

    index = whereIndex;

    return {
      type: ReservedWord.WHERE,
      value,
    };
  };

  const currentSelect = {
    value: {
      type: Command.SELECT,
      value: {
        columns: walkColumns(),
        from: walkFrom(),
        where: isWhere(tokens, index) ? walkWhere() : undefined,
      },
    },
    index: index - 1,
  };

  if (isUnion(tokens, index)) {
    const { value: nextSelect } = walk(
      tokens,
      getIndexNextSelect(tokens, index)
    );

    return {
      type: getUnionType(tokens, index),
      value: {
        left: currentSelect.value,
        right: nextSelect,
      },
    };
  }

  return currentSelect;
};
