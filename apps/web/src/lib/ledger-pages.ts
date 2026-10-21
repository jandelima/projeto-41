/**
 * Páginas do livro que não cortam um dia no meio.
 *
 * Os dias entram inteiros enquanto couberem no tamanho da página; o dia que
 * não cabe vai inteiro para a próxima. Só um dia que sozinho passa do tamanho
 * é dividido — senão ele nunca caberia em página nenhuma.
 *
 * As linhas chegam já ordenadas pelo servidor; um "dia" é uma sequência de
 * linhas com a mesma data.
 */
export function paginateByDay<T extends { date: string }>(rows: T[], pageSize: number): T[][] {
  const size = Math.max(1, pageSize);
  const days: T[][] = [];
  for (const row of rows) {
    const last = days[days.length - 1];
    if (last && last[0]!.date === row.date) last.push(row);
    else days.push([row]);
  }

  const pages: T[][] = [];
  let current: T[] = [];
  for (const day of days) {
    if (current.length > 0 && current.length + day.length > size) {
      pages.push(current);
      current = [];
    }
    if (day.length > size) {
      // Dia maior que a página: fatia em páginas cheias, e o resto segue
      // aberto para receber os dias seguintes que couberem.
      for (let start = 0; start < day.length; start += size) {
        const chunk = day.slice(start, start + size);
        if (chunk.length === size) pages.push(chunk);
        else current = chunk;
      }
      continue;
    }
    current.push(...day);
  }
  if (current.length > 0) pages.push(current);
  return pages;
}
