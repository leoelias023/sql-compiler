const removeEmptySpace = token => token.type !== Type.EMPTY_SPACE;

export default tokens => syntaticAnalysis(lexicalAnalysis(tokens));

/**
 * A type of token available in the SQL language.
 */
class Type {
  static EMPTY_SPACE = 'empty_space';
  static SELECT_STATEMENT = 'select_statement';
  static FROM_STATEMENT = 'from_statement';
  static WHERE_STATEMENT = 'where_statement';
  static ORDER_BY_STATEMENT = 'order_by_statement';
  static LIMIT_STATEMENT = 'limit_statement';
  static CONCAT_OPERATOR = 'concat_operator';
  static COMMA_DELIMITER = 'comma_delimiter';
  static STRING_LITERAL = 'string_literal';
  static FUNCTION_CALL = 'function_call';
  static UNKNOWN = 'unknown';
  static ASTERISK = 'asterisk';
}

/**
 * Reserved words that can be found in SQL Language, but primary this will be @link unknown.
 *
 */
class ReservedWord {
  static AS = 'AS';
}

const tokenTypes = {
  '': Type.EMPTY_SPACE,
  ',': Type.COMMA_DELIMITER,
  SELECT: Type.SELECT_STATEMENT,
  FROM: Type.FROM_STATEMENT,
  WHERE: Type.WHERE_STATEMENT,
  'ORDER BY': Type.ORDER_BY_STATEMENT,
  LIMIT: Type.LIMIT_STATEMENT,
  '||': Type.CONCAT_OPERATOR,
  '*': Type.ASTERISK,
};

/**
 * Make the lexical analysis of the tokens.
 *
 * @param {Array<String>} tokens Tokens to be analyzed.
 * @return {Array<Object>} The AST (Abstract Syntax Tree).
 */
export function lexicalAnalysis(tokens) {
  const isString = token => token.startsWith("'") && token.endsWith("'");
  const isFunctionCall = token => token.match(/^([a-zA-Z0-9_]+)\((.*)\)$/);

  return tokens.map(token => {
    if (isString(token)) {
      return {
        type: Type.STRING_LITERAL,
        value: token.slice(1, -1),
      };
    }

    if (isFunctionCall(token)) {
      return {
        type: Type.FUNCTION_CALL,
        value: token,
      };
    }

    return {
      type: tokenTypes[token.toUpperCase()] || Type.UNKNOWN,
      value: token,
    };
  });
}

/**
 * Make the syntatic analysis of the "lexed" tokens.
 *
 * @param {List<Object>} tokens tokens.
 * @return {List<Object>} The AST (Abstract Syntax Tree).
 */
function syntaticAnalysis(tokens) {
  const processColumnValueFromParts = columnParts => {
    if (columnParts.some(part => part.type === Type.CONCAT_OPERATOR)) {
      return {
        type: 'concatenation',
        elements: columnParts.filter(
          part => part.type !== Type.CONCAT_OPERATOR
        ),
      };
    }

    if (columnParts.length === 1) {
      return {
        type: columnParts[0].type,
        value: columnParts[0].value,
      };
    }
  };

  const walk = (tokens, index) => {
    const token = tokens[index];
    const lastToken = tokens[index - 1];

    if (token.type === Type.FUNCTION_CALL) {
      const value = token.value;

      const functionName = value.substring(0, value.indexOf('('));
      const functionArguments = value
        .substring(value.indexOf('(') + 1, value.indexOf(')'))
        .split(',');

      return {
        type: 'function_call',
        name: functionName,
        arguments: functionArguments,
      };
    }

    if (token.type == Type.CONCAT_OPERATOR) {
      return token;
    }

    if (token.type == Type.STRING_LITERAL) {
      return {
        type: 'string_literal',
        value: token.value,
      };
    }

    if (token.type === Type.ASTERISK) {
      return {
        type: 'asterisk',
        value: token.value,
      };
    }

    if (token.type === Type.FROM_STATEMENT) {
      return {
        type: 'from',
        object: walk(tokens, index + 1),
      };
    }

    if (token.type === Type.UNKNOWN) {
      if (
        lastToken.type === Type.UNKNOWN &&
        lastToken.value.toUpperCase() === ReservedWord.AS
      ) {
        return {
          type: 'alias_value',
          value: token.value,
        };
      }

      if (token.value.toUpperCase() === ReservedWord.AS) {
        return {
          type: 'column_alias',
          value: walk(tokens, index + 1),
        };
      }

      if (lastToken.type === Type.FROM_STATEMENT) {
        return {
          type: 'from_object',
          value: token.value,
        };
      }

      return {
        type: 'object_value',
        value: token.value,
      };
    }

    if (token.type === Type.SELECT_STATEMENT) {
      // get columns from tokens separated by comma delimiter

      let i = index + 1;
      const columns = [];
      let columnParts = [];
      let alias = null;

      while (tokens[i].type !== Type.FROM_STATEMENT) {
        if (tokens[i].type === Type.COMMA_DELIMITER) {
          columns.push({
            type: 'column',
            columnValue: processColumnValueFromParts(columnParts),
            alias,
          });
          alias = null;
          columnParts = [];
        } else if (
          tokens[i].type === Type.UNKNOWN &&
          tokens[i].value.toUpperCase() === ReservedWord.AS
        ) {
          alias = walk(tokens, i);
        } else {
          const element = walk(tokens, i);
          if (element.type !== 'alias_value') columnParts.push(element);
        }
        i++;
      }

      if (columnParts.length > 0) {
        columns.push({
          type: 'column',
          columnValue: processColumnValueFromParts(columnParts),
          alias,
        });
      }

      return {
        type: 'select',
        columns: columns,
        from: walk(tokens, i + 1),
      };
    }

    if (index < tokens.length - 1) {
      return walk(tokens, index + 1);
    }
  };

  return walk(tokens.filter(removeEmptySpace), 0);
}
