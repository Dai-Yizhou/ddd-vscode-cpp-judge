#include <iostream>
using namespace std;

int main() {
    // 触发段错误 SIGSEGV
    int *p = nullptr;
    *p = 42;
    return 0;
}
