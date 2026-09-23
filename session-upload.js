(function initializeSessionUpload(global) {
  "use strict";

  const LIMITS = Object.freeze({
    fileBytes: 256 * 1024,
    titleCharacters: 120,
    categoryTitleCharacters: 80,
    questionCharacters: 1000,
    answerCharacters: 300,
    categories: 6,
    questionsPerCategory: 5
  });
  const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

  function validateAndNormalize(document) {
    const errors = [];
    if (!isObject(document)) {
      return invalid([error("document.type", "$ must be a JSON object.")]);
    }

    let title = "Custom Session";
    if (Object.hasOwn(document, "title")) {
      title = validateText(document.title, "title", LIMITS.titleCharacters, errors);
    }

    const categories = [];
    const clues = [];
    let dailyDoubleClueId = null;

    if (!Array.isArray(document.categories)) {
      errors.push(error("categories.type", "categories must be an array."));
    } else {
      if (document.categories.length !== LIMITS.categories) {
        errors.push(error(
          "categories.length",
          `categories must contain exactly ${LIMITS.categories} items.`
        ));
      }

      document.categories.forEach((category, categoryIndex) => {
        const categoryPath = `categories[${categoryIndex}]`;
        if (!isObject(category)) {
          errors.push(error("category.type", `${categoryPath} must be an object.`));
          return;
        }

        const categoryTitle = validateText(
          category.title,
          `${categoryPath}.title`,
          LIMITS.categoryTitleCharacters,
          errors
        );
        const categoryId = `custom-category-${categoryIndex}`;
        categories.push({ id: categoryId, title: categoryTitle, comment: "" });

        if (!Array.isArray(category.questions)) {
          errors.push(error("questions.type", `${categoryPath}.questions must be an array.`));
          return;
        }

        if (category.questions.length !== LIMITS.questionsPerCategory) {
          errors.push(error(
            "questions.length",
            `${categoryPath}.questions must contain exactly ${LIMITS.questionsPerCategory} items.`
          ));
        }

        category.questions.forEach((question, questionIndex) => {
          const questionPath = `${categoryPath}.questions[${questionIndex}]`;
          if (!isObject(question)) {
            errors.push(error("question.type", `${questionPath} must be an object.`));
            return;
          }

          const questionText = validateText(
            question.question,
            `${questionPath}.question`,
            LIMITS.questionCharacters,
            errors
          );
          const answer = validateText(
            question.answer,
            `${questionPath}.answer`,
            LIMITS.answerCharacters,
            errors
          );
          let isDailyDouble = false;
          if (Object.hasOwn(question, "dailyDouble")) {
            if (typeof question.dailyDouble !== "boolean") {
              errors.push(error(
                "dailyDouble.type",
                `${questionPath}.dailyDouble must be true or false.`
              ));
            } else {
              isDailyDouble = question.dailyDouble;
            }
          }

          const clueId = `${categoryId}-question-${questionIndex}`;
          if (isDailyDouble) {
            dailyDoubleClueId = clueId;
          }

          const numericValue = (questionIndex + 1) * 200;
          clues.push({
            id: clueId,
            categoryId,
            rowIndex: questionIndex,
            categoryIndex,
            value: `$${numericValue.toLocaleString("en-US")}`,
            numericValue,
            clueText: questionText,
            response: answer,
            status: "available",
            outcome: null
          });
        });
      });
    }

    if (errors.length) {
      return invalid(errors);
    }

    return {
      valid: true,
      errors: [],
      board: {
        episodeTitle: title,
        episodeUrl: "",
        categories,
        clues,
        dailyDoubleClueId
      }
    };
  }

  function validateText(value, path, maximum, errors) {
    if (typeof value !== "string") {
      errors.push(error("text.type", `${path} must be a string.`));
      return "";
    }

    const normalized = value.trim();
    if (!normalized) {
      errors.push(error("text.empty", `${path} must not be empty or whitespace only.`));
    }
    if (characterCount(normalized) > maximum) {
      errors.push(error("text.length", `${path} must be ${maximum} characters or fewer.`));
    }
    if (DISALLOWED_CONTROL_CHARACTERS.test(normalized)) {
      errors.push(error("text.control", `${path} contains unsupported control characters.`));
    }
    return normalized;
  }

  function characterCount(value) {
    return Array.from(value).length;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function error(code, message) {
    return { code, message };
  }

  function invalid(errors) {
    return { valid: false, errors, board: null };
  }

  const api = Object.freeze({ LIMITS, validateAndNormalize });
  global.jeopardySession = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
}(typeof window === "undefined" ? globalThis : window));
