export const listDiff = <T>(
  firstList: Array<T> = [],
  secondList: Array<T> = [],
) => {
  // let actionList:Array<T> = firstList.length >= secondList.length ? firstList:secondList;
  // let
  let actionList: Array<T>;
  let callList: Array<T>;

  if (firstList.length >= secondList.length) {
    actionList = firstList;
    callList = secondList;
  } else {
    actionList = secondList;
    callList = firstList;
  }

  return actionList.filter(item => {
    return !callList.includes(item);
  });
};
