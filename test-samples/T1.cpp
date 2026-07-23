//A_1
//

//#define _DEBUG_

#include<iostream>
#include<algorithm>
using namespace std;
using ll=long long;

const int MAXN=200003;
ll n,q,s[MAXN],pos[MAXN];

struct Point{
    ll x,y;
}a[MAXN];
bool cmp(Point A,Point B){
    return A.x<B.x;
}


int main(){
    cin.tie(0)->sync_with_stdio(0);

    cin>>n;
    for(int i=1;i<=n;i++){
        cin>>a[i].x;
    }
    for(int i=1;i<=n;i++){
        cin>>a[i].y;
    }
    
    //离散化
    sort(a+1,a+1+n,cmp);
    int l=1,r=1,p=0;
    while(l<=r and r<=n){
        l=r;
        p++;
        #ifdef _DEBUG_
        cout<<l<<r<<p<<'\n';
        #endif
        s[p]+=a[l].y;
        pos[p]=a[l].x;
        #ifdef _DEBUG_
        if(r>=10 or p>=100){cout<<l<<r<<p<<"oops!44"<<'\n';exit(0);}
        #endif
        while(a[r+1].x==a[l].x){
            r++;
            #ifdef _DEBUG_
            if(r>=10 or p>=10){cout<<l<<r<<p<<"oops!49"<<'\n';exit(0);}
            #endif
            s[p]+=a[r].y;
        }
        r++;
        if(r>n)break;
    }
    #ifdef _DEBUG_
    cout<<"s"<<p<<'\n';
    for(int i=1;i<=p;i++)cout<<s[i]<<'\n';
    cout<<'\n';
    #endif
    //前缀和
    for(int i=1;i<=p;i++){
        s[i]+=s[i-1];
    }
    #ifdef _DEBUG_
    cerr<<"s"<<p<<'\n';
    for(int i=1;i<=p;i++)clog<<s[i]<<'\n';
    cerr<<'\n';
    #endif

    //询问
    cin>>q;
    for(int i=1;i<=q;i++){
        cin>>l>>r;
        cout<<s[upper_bound(pos+1,pos+p+1,r)-pos-1]-s[lower_bound(pos+1,pos+p+1,l)-pos-1]<<'\n';
    }


    return 0;
}
